import { BadGatewayException, BadRequestException, ConflictException, Inject, Injectable, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { Pool } from 'pg';
import { AuditService, PG_POOL } from '../audit/audit.service';
import { STORAGE_PORT, StoragePort } from '../supply/files/storage.port';
import { badgeExpiry, checkDecision, checkRevoke } from './cases.rules';

const LINK_TTL_SEC = 300;   // a document link works for 5 minutes

/**
 * Reviewer side of T1 review (queue and claim). A reviewer never sees, claims or decides a case of an
 * organisation they belong to: such cases are simply absent from their queue and answer 404.
 */
@Injectable()
export class ReviewService {
  constructor(@Inject(PG_POOL) private pool: Pool, @Inject(AuditService) private audit: AuditService, @Inject(STORAGE_PORT) private storage: StoragePort | null) {}

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

  /** The case as the reviewer who holds it sees it (or, afterwards, the one who decided it). Every read is logged. */
  async detail(caseId: string, reviewerId: string) {
    const row = (await this.pool.query(`${ReviewService.SELECT} WHERE c.id=$1 AND ((c.status='in_review' AND c.claimed_by=$2) OR c.decided_by=$2)`, [caseId, reviewerId])).rows[0];
    if (!row) throw new NotFoundException('Case not found');
    const files = (await this.pool.query(
      `SELECT f.id, f.doc_type AS "docType", f.original_name AS "originalName", f.mime_type AS "mimeType", f.size_bytes::int AS "sizeBytes", f.created_at AS "uploadedAt"
         FROM verification.case_files cf JOIN supply.files f ON f.id = cf.file_id WHERE cf.case_id=$1 ORDER BY f.created_at, f.id`, [caseId])).rows;
    const opened = new Set((await this.pool.query(`SELECT DISTINCT split_part(reason, ' file ', 2) AS fid FROM governance.data_access_log WHERE accessor_id=$1 AND resource='file:document' AND reason LIKE $2`, [reviewerId, `case ${caseId} file %`])).rows.map((r: any) => r.fid));
    const earlier = row.is_appeal ? (await this.pool.query(`SELECT o.reason_code AS "reasonCode", o.note FROM verification.cases o JOIN verification.cases a ON a.appeal_of = o.id WHERE a.id=$1`, [caseId])).rows[0] ?? null : null;
    const outcome = (await this.pool.query(`SELECT status, reason_code AS "reasonCode", note, decided_at AS "decidedAt" FROM verification.cases WHERE id=$1`, [caseId])).rows[0];
    await this.pool.query(`INSERT INTO governance.data_access_log (accessor_id, resource, reason) VALUES ($1,'verification_case',$2)`, [reviewerId, `case ${caseId}`]);
    return {
      ...this.shape(row, reviewerId), files: files.map((f: any) => ({ ...f, opened: opened.has(f.id) })),
      allOpened: files.length > 0 && files.every((f: any) => opened.has(f.id)),
      earlierDecision: earlier, decided: ['approved', 'rejected'].includes(outcome.status) ? outcome : null,
    };
  }

  /** A link that opens one attached document for 5 minutes. Only the holder of the case, only documents attached to it, always logged. */
  async openFile(caseId: string, fileId: string, reviewerId: string) {
    if (!this.storage) throw new ServiceUnavailableException('File storage is not configured');
    const f = (await this.pool.query(
      `SELECT f.storage_path, f.original_name, f.uploaded_by FROM verification.cases c JOIN verification.case_files cf ON cf.case_id = c.id JOIN supply.files f ON f.id = cf.file_id
        WHERE c.id=$1 AND f.id=$2 AND c.status='in_review' AND c.claimed_by=$3`, [caseId, fileId, reviewerId])).rows[0];
    if (!f) throw new NotFoundException('Document not found');
    let url: string;
    try { url = await this.storage.createSignedDownload(f.storage_path, LINK_TTL_SEC, f.original_name ?? 'document'); }
    catch { throw new BadGatewayException('File storage is unavailable. Please try again.'); }
    await this.pool.query(`INSERT INTO governance.data_access_log (accessor_id, subject_user_id, resource, reason) VALUES ($1,$2,'file:document',$3)`, [reviewerId, f.uploaded_by ?? null, `case ${caseId} file ${fileId}`]);
    await this.audit.record({ actorId: reviewerId, action: 'verification.document_opened', subjectType: 'verification_case', subjectId: caseId, metadata: { fileId } });
    return { url, expiresInSec: LINK_TTL_SEC };
  }

  /** The human decision. Approve issues a 12-month T1 badge; the other two need a reason code. */
  async decide(caseId: string, reviewerId: string, body: { decision?: unknown; reasonCode?: unknown; note?: unknown }) {
    const bad = checkDecision(body); if (bad) throw new BadRequestException(bad);
    const decision = body.decision as 'approve' | 'needs_changes' | 'reject';
    const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null;
    const reason = decision === 'approve' ? null : (body.reasonCode as string);
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const row = (await c.query(`SELECT id, org_id, property_id, status, claimed_by, due_at, submitted_at, (SELECT count(*)::int FROM verification.case_files WHERE case_id=$1) AS files FROM verification.cases WHERE id=$1 FOR UPDATE`, [caseId])).rows[0];
      if (!row || row.claimed_by !== reviewerId) throw new NotFoundException('Case not found');
      if (row.status !== 'in_review') throw new ConflictException({ code: 'case_not_open', message: 'This case has already been decided.' });
      if (decision === 'approve') {
        const seen = (await c.query(`SELECT count(DISTINCT split_part(reason, ' file ', 2))::int n FROM governance.data_access_log WHERE accessor_id=$1 AND resource='file:document' AND reason LIKE $2`, [reviewerId, `case ${caseId} file %`])).rows[0].n;
        if (!row.files || seen < row.files) throw new UnprocessableEntityException({ code: 'documents_not_opened', message: 'Open every attached document before approving.' });
      }
      let badgeId: string | null = null;
      if (decision === 'approve') {
        const now = new Date();
        badgeId = (await c.query(`INSERT INTO verification.badges (subject_type, subject_id, level, verified_by, evidence_ref, issued_at, expires_at) VALUES ('property',$1,'t1_documented',$2,$3,$4,$5) RETURNING id`,
          [row.property_id, reviewerId, `case:${caseId}`, now, badgeExpiry(now)])).rows[0].id;
      }
      const status = decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'needs_changes';
      const final = decision !== 'needs_changes';
      try {
        await c.query(
          `UPDATE verification.cases SET status=$2, reason_code=$3, note=$4, badge_id=$5,
                  decided_by = CASE WHEN $6 THEN $7::uuid END, decided_at = CASE WHEN $6 THEN now() END,
                  paused_at = CASE WHEN $2='needs_changes' THEN now() END,
                  claimed_by = CASE WHEN $2='needs_changes' THEN NULL ELSE claimed_by END, claimed_at = CASE WHEN $2='needs_changes' THEN NULL ELSE claimed_at END
            WHERE id=$1`, [caseId, status, reason, note, badgeId, final, reviewerId]);
      } catch (e: any) {   // the database rules are the last line of defence: they refuse self-review and a repeat reviewer on an appeal
        if (/reviewer|decider|different reviewer/.test(String(e?.message))) throw new NotFoundException('Case not found');
        throw e;
      }
      await c.query(`INSERT INTO governance.audit_events (actor_id, action, subject_type, subject_id, metadata) VALUES ($1,$2,'verification_case',$3,$4)`,
        [reviewerId, `verification.${status}`, caseId, JSON.stringify({ propertyId: row.property_id, orgId: row.org_id, reasonCode: reason, badgeId, flagged: reason === 'suspected_forgery' })]);
      await c.query('COMMIT');
      return { id: caseId, status, reasonCode: reason, badgeId };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  }

  /** Active documented badges a reviewer may revoke (never those of an organisation they belong to), soonest to expire first. */
  async badges(reviewerId: string) {
    const rows = (await this.pool.query(
      `SELECT b.id, b.issued_at, b.expires_at, p.name AS property_name, p.address_text, o.name AS org_name
         FROM verification.badges b JOIN supply.properties p ON p.id = b.subject_id JOIN identity.organizations o ON o.id = p.org_id
        WHERE b.subject_type='property' AND b.level='t1_documented' AND b.revoked_at IS NULL AND b.expires_at > now()
          AND NOT EXISTS (SELECT 1 FROM identity.memberships m WHERE m.user_id=$1 AND m.org_id = p.org_id)
        ORDER BY b.expires_at ASC LIMIT 200`, [reviewerId])).rows;
    await this.pool.query(`INSERT INTO governance.data_access_log (accessor_id, resource, reason) VALUES ($1,'verification_badge_list',$2)`, [reviewerId, `listed ${rows.length}`]);
    return rows.map((r: any) => ({ id: r.id, propertyName: r.property_name, address: r.address_text, orgName: r.org_name, issuedAt: r.issued_at, expiresAt: r.expires_at }));
  }

  /** Withdraw a badge. A reason code is mandatory; the property stops counting as verified at once. */
  async revoke(badgeId: string, reviewerId: string, body: { reasonCode?: unknown; note?: unknown }) {
    const bad = checkRevoke(body); if (bad) throw new BadRequestException(bad);
    const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null;
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const row = (await c.query(
        `SELECT b.id, b.subject_id, p.org_id FROM verification.badges b JOIN supply.properties p ON p.id = b.subject_id
          WHERE b.id=$1 AND b.subject_type='property' AND b.level='t1_documented' AND b.revoked_at IS NULL AND b.expires_at > now() FOR UPDATE OF b`, [badgeId])).rows[0];
      const own = row && (await c.query('SELECT 1 FROM identity.memberships WHERE user_id=$1 AND org_id=$2', [reviewerId, row.org_id])).rowCount! > 0;
      if (!row || own) throw new NotFoundException('Badge not found');
      await c.query(`UPDATE verification.badges SET revoked_at=now(), revoke_reason_code=$2, revoke_note=$3 WHERE id=$1`, [badgeId, body.reasonCode, note]);
      await c.query(`INSERT INTO governance.audit_events (actor_id, action, subject_type, subject_id, metadata) VALUES ($1,'verification.badge_revoked','badge',$2,$3)`,
        [reviewerId, badgeId, JSON.stringify({ propertyId: row.subject_id, orgId: row.org_id, reasonCode: body.reasonCode, flagged: body.reasonCode === 'suspected_forgery' })]);
      await c.query('COMMIT');
      return { id: badgeId, revoked: true, reasonCode: body.reasonCode };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  }
}
