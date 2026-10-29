import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { AuditService, PG_POOL } from '../audit/audit.service';

/**
 * Reviewer side of T1 review (queue and claim). A reviewer never sees, claims or decides a case of an
 * organisation they belong to: such cases are simply absent from their queue and answer 404.
 */
@Injectable()
export class ReviewService {
  constructor(@Inject(PG_POOL) private pool: Pool, @Inject(AuditService) private audit: AuditService) {}

  private static readonly SELECT = `
    SELECT c.id, c.status, c.submitted_at, c.due_at, c.risk_flags, c.appeal_of IS NOT NULL AS is_appeal, c.claimed_by, c.claimed_at,
           p.name AS property_name, p.address_text, o.name AS org_name,
           (SELECT count(*)::int FROM verification.case_files cf WHERE cf.case_id = c.id) AS file_count
      FROM verification.cases c
      JOIN supply.properties p ON p.id = c.property_id
      JOIN identity.organizations o ON o.id = c.org_id`;

  private shape(r: any, me: string, now = Date.now()) {
    const due = r.due_at ? new Date(r.due_at).getTime() : null;
    return {
      id: r.id, status: r.status, propertyName: r.property_name, address: r.address_text, orgName: r.org_name,
      submittedAt: r.submitted_at, dueAt: r.due_at, minutesLeft: due === null ? null : Math.round((due - now) / 60_000),
      breached: due !== null && due < now, riskFlags: r.risk_flags, isAppeal: r.is_appeal, fileCount: r.file_count,
      claimedByMe: r.claimed_by === me, claimed: !!r.claimed_by,   // never the identity of another reviewer
    };
  }

  /** Open cases this reviewer may take, plus the ones they already hold: most urgent first, then riskiest, then oldest. */
  async queue(reviewerId: string) {
    const rows = (await this.pool.query(
      `${ReviewService.SELECT}
        WHERE ((c.status = 'submitted') OR (c.status = 'in_review' AND c.claimed_by = $1))
          AND NOT EXISTS (SELECT 1 FROM identity.memberships m WHERE m.user_id = $1 AND m.org_id = c.org_id)
          AND NOT (c.appeal_of IS NOT NULL AND EXISTS (SELECT 1 FROM verification.cases o WHERE o.id = c.appeal_of AND o.decided_by = $1))
        ORDER BY (c.claimed_by = $1) DESC NULLS LAST, c.due_at ASC, cardinality(c.risk_flags) DESC, c.submitted_at ASC LIMIT 200`, [reviewerId])).rows;
    await this.pool.query(`INSERT INTO governance.data_access_log (accessor_id, resource, reason) VALUES ($1,'verification_case_queue',$2)`, [reviewerId, `listed ${rows.length}`]);
    return rows.map((r) => this.shape(r, reviewerId));
  }

  async claim(caseId: string, reviewerId: string) {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const row = (await c.query(`${ReviewService.SELECT} WHERE c.id = $1 FOR UPDATE OF c`, [caseId])).rows[0];
      // Same answer for "does not exist" and "you may not see it", so a reviewer cannot probe other organisations.
      const hidden = !row || (await c.query(`SELECT 1 FROM identity.memberships WHERE user_id=$1 AND org_id=(SELECT org_id FROM verification.cases WHERE id=$2)`, [reviewerId, caseId])).rowCount! > 0
        || (row.is_appeal && (await c.query(`SELECT 1 FROM verification.cases o JOIN verification.cases a ON a.appeal_of = o.id WHERE a.id=$1 AND o.decided_by=$2`, [caseId, reviewerId])).rowCount! > 0);
      if (hidden) throw new NotFoundException('Case not found');
      if (row.status === 'in_review' && row.claimed_by === reviewerId) { await c.query('COMMIT'); return this.shape(row, reviewerId); }   // claiming twice is harmless
      if (row.status !== 'submitted') throw new ConflictException({ code: 'case_not_claimable', message: 'This case is already taken or decided.' });
      const up = (await c.query(`UPDATE verification.cases SET status='in_review', claimed_by=$2, claimed_at=now() WHERE id=$1 RETURNING claimed_at`, [caseId, reviewerId])).rows[0];
      await c.query(`INSERT INTO governance.audit_events (actor_id, action, subject_type, subject_id, metadata) VALUES ($1,'verification.case_claimed','verification_case',$2,'{}')`, [reviewerId, caseId]);
      await c.query('COMMIT');
      return this.shape({ ...row, status: 'in_review', claimed_by: reviewerId, claimed_at: up.claimed_at }, reviewerId);
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  }

  /** Give a case back to the queue. Only the reviewer holding it can do this. */
  async release(caseId: string, reviewerId: string) {
    const r = await this.pool.query(
      `UPDATE verification.cases SET status='submitted', claimed_by=NULL, claimed_at=NULL WHERE id=$1 AND status='in_review' AND claimed_by=$2 RETURNING id`, [caseId, reviewerId]);
    if (!r.rowCount) throw new NotFoundException('Case not found');
    await this.audit.record({ actorId: reviewerId, action: 'verification.case_released', subjectType: 'verification_case', subjectId: caseId });
    return { id: caseId, status: 'submitted' };
  }
}
