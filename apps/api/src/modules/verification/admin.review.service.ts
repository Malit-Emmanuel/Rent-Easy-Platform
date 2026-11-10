import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { AuditService, PG_POOL } from '../audit/audit.service';
import { ReviewService } from './review.service';

/** Admin (super_admin) tools for claims that have sat too long. Advisory data only: an admin releases a case by hand, with a reason. Nothing is released automatically. */
@Injectable()
export class AdminReviewService {
  constructor(@Inject(PG_POOL) private pool: Pool, @Inject(AuditService) private audit: AuditService, @Inject(ReviewService) private review: ReviewService) {}

  private async staleHours(): Promise<number> {
    const r = (await this.pool.query(`SELECT threshold FROM verification.integrity_rules WHERE code='stale_claim'`)).rows[0];
    return r ? Number(r.threshold) : 4;
  }

  /** Cases claimed for longer than the stale-claim threshold. Shows the case and the time, never the contents or the reviewer's other work. */
  async staleClaims(adminId: string) {
    const hours = await this.staleHours();
    const rows = (await this.pool.query(
      `SELECT c.id, c.tier, c.claimed_by AS reviewer_id, c.claimed_at, c.due_at,
              floor(extract(epoch FROM (now() - c.claimed_at)) / 60)::int AS held_minutes
         FROM verification.cases c WHERE c.status='in_review' AND c.claimed_at < now() - ($1 || ' hours')::interval ORDER BY c.claimed_at ASC LIMIT 200`, [String(hours)])).rows;
    await this.pool.query(`INSERT INTO governance.data_access_log (accessor_id, resource, reason) VALUES ($1,'admin_stale_claims',$2)`, [adminId, `listed ${rows.length}`]);
    return { thresholdHours: hours, claims: rows.map((r) => ({ id: r.id, tier: r.tier, reviewerId: r.reviewer_id, claimedAt: r.claimed_at, dueAt: r.due_at, heldMinutes: r.held_minutes, breached: new Date(r.due_at) < new Date() })) };
  }

  /** Puts a stale claimed case back in the queue. Needs a written reason; only works once the claim is older than the threshold. */
  async releaseStale(caseId: string, adminId: string, body: { reason?: unknown }) {
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    if (reason.length < 5 || reason.length > 500) throw new BadRequestException('Give a reason of 5 to 500 characters.');
    const hours = await this.staleHours();
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const row = (await c.query(`SELECT claimed_by, claimed_at FROM verification.cases WHERE id=$1 AND status='in_review' FOR UPDATE`, [caseId])).rows[0];
      if (!row) throw new NotFoundException('Case not found');
      if (new Date(row.claimed_at).getTime() > Date.now() - hours * 3600e3) throw new ConflictException({ code: 'claim_not_stale', message: `This claim is less than ${hours} hours old.` });
      await this.review.closeSession(c, caseId, row.claimed_by, row.claimed_at, 'admin_released');
      await c.query(`UPDATE verification.cases SET status='submitted', claimed_by=NULL, claimed_at=NULL WHERE id=$1`, [caseId]);
      await c.query(`INSERT INTO governance.audit_events (actor_id, action, subject_type, subject_id, metadata) VALUES ($1,'verification.case_admin_released','verification_case',$2,$3)`,
        [adminId, caseId, JSON.stringify({ reviewerId: row.claimed_by, reason })]);
      await c.query('COMMIT');
      return { id: caseId, status: 'submitted' };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  }
}
