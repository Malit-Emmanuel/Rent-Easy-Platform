import { Inject, Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { AuditService, PG_POOL } from '../audit/audit.service';
import { STORAGE_PORT, StoragePort } from '../supply/files/storage.port';

const BATCH = 50, MAX_ROUNDS = 10;   // at most 500 files per run, so one run can never take long

/**
 * The daily deletion of T2 videos. Two kinds are due (the database decides which, in verification.t2_purge_candidates):
 *   retention:   90 days after the case was finally decided (the setting lives in verification.t2_video_retention);
 *   unsubmitted: a recording that was never sent for review, 24 hours after its challenge ended.
 * The stored bytes are removed first and the file is marked deleted second. If the second step fails the next run simply tries again
 * (removing a missing object is harmless). The case, the readings, the checklist, the decision and the file fingerprint all stay.
 * Output is counts only: no file names, no ids, nothing personal.
 */
@Injectable()
export class T2RetentionService {
  private log = new Logger('T2Retention');
  constructor(@Inject(PG_POOL) private pool: Pool, @Inject(AuditService) private audit: AuditService, @Inject(STORAGE_PORT) private storage: StoragePort | null) {}

  async purge(): Promise<{ retention: number; unsubmitted: number; failed: number }> {
    const done = { retention: 0, unsubmitted: 0, failed: 0 };
    if (!this.storage) { this.log.warn('File storage is not configured: nothing was deleted'); return done; }
    const tried = new Set<string>();   // a file that fails once is not retried in the same run
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const rows = (await this.pool.query(`SELECT file_id, storage_path, why FROM verification.t2_purge_candidates($1)`, [BATCH])).rows
        .filter((r: any) => !tried.has(r.file_id));
      if (!rows.length) break;
      for (const r of rows) {
        tried.add(r.file_id);
        try {
          await this.storage.remove(r.storage_path);
          const res = await this.pool.query(`UPDATE supply.files SET status='deleted', deleted_at=now() WHERE id=$1 AND status IN ('ready','pending')`, [r.file_id]);
          if (res.rowCount) done[r.why as 'retention' | 'unsubmitted']++;
        } catch (e) { done.failed++; this.log.error(`could not delete a video (${r.why}): ${(e as Error).message}`); }
      }
    }
    if (done.retention || done.unsubmitted || done.failed) {
      await this.audit.record({ action: 'verification.t2_videos_purged', subjectType: 'system', subjectId: 't2_retention', metadata: { ...done } });
    }
    return done;
  }
}
