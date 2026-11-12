import { BadGatewayException, BadRequestException, ConflictException, Inject, Injectable, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { Pool } from 'pg';
import { AuditService, PG_POOL } from '../audit/audit.service';
import { parseMonth, MONTH_BOUNDS } from '../../common/month';
import { STORAGE_PORT, StoragePort } from '../supply/files/storage.port';
import { badgeExpiry, checkDecision, checkRevoke } from './cases.rules';
import { T2_CHECKLIST, T2_REASON_CODES, T2_VIDEO_LINK_SEC, checkT2Decision, t2BadgeExpiry } from './t2.rules';

const LINK_TTL_SEC = 300;   // a document link works for 5 minutes

/**
 * Reviewer side of T1 review (queue and claim). A reviewer never sees, claims or decides a case of an
 * organisation they belong to: such cases are simply absent from their queue and answer 404.
 */
@Injectable()
export class ReviewService {
  constructor(@Inject(PG_POOL) private pool: Pool, @Inject(AuditService) private audit: AuditService, @Inject(STORAGE_PORT) private storage: StoragePort | null) {}

  private static readonly SELECT = `
    SELECT c.id, c.tier, c.status, c.submitted_at, c.due_at, c.risk_flags, c.appeal_of IS NOT NULL AS is_appeal, c.claimed_by, c.claimed_at,
           p.name AS property_name, p.address_text, o.name AS org_name,
           (SELECT count(*)::int FROM verification.case_files cf WHERE cf.case_id = c.id) AS file_count
      FROM verification.cases c
      JOIN supply.properties p ON p.id = c.property_id
      JOIN identity.organizations o ON o.id = c.org_id`;

  private shape(r: any, me: string, now = Date.now()) {
    const due = r.due_at ? new Date(r.due_at).getTime() : null;
    return {
      id: r.id, tier: r.tier, status: r.status, propertyName: r.property_name, address: r.address_text, orgName: r.org_name,
      submittedAt: r.submitted_at, dueAt: r.due_at, minutesLeft: due === null ? null : Math.round((due - now) / 60_000),
      breached: due !== null && due < now, riskFlags: r.risk_flags, isAppeal: r.is_appeal, fileCount: r.file_count,
      claimedByMe: r.claimed_by === me, claimed: !!r.claimed_by,   // never the identity of another reviewer
    };
  }

  /** Open cases this reviewer may take, plus the ones they already hold: most urgent first, then riskiest, then oldest. */
  async queue(reviewerId: string) {
    const rows = (await this.pool.query(
      `${ReviewService.SELECT}
        WHERE c.tier IN ('t1','t2') AND ((c.status = 'submitted') OR (c.status = 'in_review' AND c.claimed_by = $1))
          AND NOT EXISTS (SELECT 1 FROM identity.memberships m WHERE m.user_id = $1 AND m.org_id = c.org_id)
          AND NOT (c.appeal_of IS NOT NULL AND EXISTS (SELECT 1 FROM verification.cases o WHERE o.id = c.appeal_of AND o.decided_by = $1))
        ORDER BY (c.claimed_by = $1) DESC NULLS LAST, c.due_at ASC, cardinality(c.risk_flags) DESC, c.submitted_at ASC LIMIT 200`, [reviewerId])).rows;
    await this.pool.query(`INSERT INTO governance.data_access_log (accessor_id, resource, reason) VALUES ($1,'verification_case_queue',$2)`, [reviewerId, `listed ${rows.length}`]);
    return rows.map((r) => this.shape(r, reviewerId));
  }

  async claim(caseId: string, reviewerId: string) {
    const c = await this.pool.connect();
    let ownOrg = false;
    try {
      await c.query('BEGIN');
      const row = (await c.query(`${ReviewService.SELECT} WHERE c.id = $1 FOR UPDATE OF c`, [caseId])).rows[0];
      // Same answer for "does not exist" and "you may not see it", so a reviewer cannot probe other organisations.
      ownOrg = !!row && (await c.query(`SELECT 1 FROM identity.memberships WHERE user_id=$1 AND org_id=(SELECT org_id FROM verification.cases WHERE id=$2)`, [reviewerId, caseId])).rowCount! > 0;
      const hidden = !row || !['t1', 't2'].includes(row.tier) || ownOrg
        || (row.is_appeal && (await c.query(`SELECT 1 FROM verification.cases o JOIN verification.cases a ON a.appeal_of = o.id WHERE a.id=$1 AND o.decided_by=$2`, [caseId, reviewerId])).rowCount! > 0);
      if (hidden) throw new NotFoundException('Case not found');
      if (row.status === 'in_review' && row.claimed_by === reviewerId) { await c.query('COMMIT'); return this.shape(row, reviewerId); }   // claiming twice is harmless
      if (row.status !== 'submitted') throw new ConflictException({ code: 'case_not_claimable', message: 'This case is already taken or decided.' });
      const up = (await c.query(`UPDATE verification.cases SET status='in_review', claimed_by=$2, claimed_at=now() WHERE id=$1 RETURNING claimed_at`, [caseId, reviewerId])).rows[0];
      await c.query(`INSERT INTO governance.audit_events (actor_id, action, subject_type, subject_id, metadata) VALUES ($1,'verification.case_claimed','verification_case',$2,'{}')`, [reviewerId, caseId]);
      await c.query('COMMIT');
      return this.shape({ ...row, status: 'in_review', claimed_by: reviewerId, claimed_at: up.claimed_at }, reviewerId);
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      // The reviewer still gets the same plain "not found"; the refused attempt is recorded for the integrity report (rule 10).
      if (ownOrg) await this.audit.record({ actorId: reviewerId, action: 'verification.own_org_claim_refused', subjectType: 'verification_case', subjectId: caseId }).catch(() => {});
      throw e;
    } finally { c.release(); }
  }

  /** Writes the time record for a stretch of work that has just ended (in the caller's transaction). */
  async closeSession(c: { query: (q: string, v?: unknown[]) => Promise<any> }, caseId: string, reviewerId: string, claimedAt: Date | null, reason: 'decided' | 'released' | 'sent_back' | 'admin_released') {
    if (!claimedAt) return;
    // A savepoint, so a problem with the time record can never stop a decision or a release.
    await c.query('SAVEPOINT time_record');
    try { await c.query(`SELECT verification.close_review_session($1,$2,$3,clock_timestamp(),$4)`, [caseId, reviewerId, claimedAt, reason]); await c.query('RELEASE SAVEPOINT time_record'); }
    catch { await c.query('ROLLBACK TO SAVEPOINT time_record'); }
  }

  /** Give a case back to the queue. Only the reviewer holding it can do this. */
  async release(caseId: string, reviewerId: string) {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const held = (await c.query(`SELECT claimed_at FROM verification.cases WHERE id=$1 AND status='in_review' AND claimed_by=$2 FOR UPDATE`, [caseId, reviewerId])).rows[0];
      if (!held) throw new NotFoundException('Case not found');
      await this.closeSession(c, caseId, reviewerId, held.claimed_at, 'released');
      await c.query(`UPDATE verification.cases SET status='submitted', claimed_by=NULL, claimed_at=NULL WHERE id=$1`, [caseId]);
      await c.query(`INSERT INTO governance.audit_events (actor_id, action, subject_type, subject_id, metadata) VALUES ($1,'verification.case_released','verification_case',$2,'{}')`, [reviewerId, caseId]);
      await c.query('COMMIT');
      return { id: caseId, status: 'submitted' };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  }

  /** A reviewer's own figures for a month, and nobody else's. Not a score: no pay, ranking or consequence comes from it. */
  async myStats(reviewerId: string, monthRaw?: unknown) {
    const month = parseMonth(monthRaw);
    const q = (sql: string) => this.pool.query(`WITH m AS ${MONTH_BOUNDS} ${sql}`, [month, reviewerId]).then((r) => r.rows[0]);
    const d = await q(`SELECT count(*)::int decisions, count(*) FILTER (WHERE c.status='approved')::int approved, count(*) FILTER (WHERE c.status='rejected')::int rejected,
                              count(*) FILTER (WHERE c.tier='t1')::int t1, count(*) FILTER (WHERE c.tier='t2')::int t2
                         FROM verification.cases c, m WHERE c.decided_by=$2 AND c.status IN ('approved','rejected') AND c.decided_at >= m.s AND c.decided_at < m.e`);
    const s = await q(`SELECT count(*)::int sessions, coalesce(sum(s.handling_seconds),0)::bigint secs, count(*) FILTER (WHERE s.end_reason='sent_back')::int sent_back,
                              count(*) FILTER (WHERE s.end_reason IN ('released','admin_released'))::int released
                         FROM verification.review_sessions s, m WHERE s.reviewer_id=$2 AND s.ended_at >= m.s AND s.ended_at < m.e`);
    const med = await q(`SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY h.secs / 60.0) med, count(*)::int n
                           FROM (SELECT s.case_id, sum(s.handling_seconds) secs FROM verification.review_sessions s, m WHERE s.reviewer_id=$2 AND s.end_reason IN ('decided','sent_back') AND s.ended_at >= m.s AND s.ended_at < m.e GROUP BY 1) h`);
    return {
      month, decisions: d.decisions, approved: d.approved, rejected: d.rejected, t1: d.t1, t2: d.t2,
      approvalRatePct: d.decisions ? Math.round(1000 * d.approved / d.decisions) / 10 : null, sampleSize: d.decisions,
      sessions: s.sessions, handlingHours: Math.round(Number(s.secs) / 36) / 100, sentBack: s.sent_back, released: s.released,
      medianHandlingMinutes: med.med === null ? null : Math.round(Number(med.med) * 10) / 10, medianSampleSize: med.n,
      note: 'Only you can see this. It is not a score, and nothing is paid, ranked or decided from it.',
    };
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
    const docsOpened = files.length > 0 && files.every((f: any) => opened.has(f.id));
    const t2 = row.tier === 't2' ? await this.t2Evidence(caseId, row.is_appeal, reviewerId) : null;
    return {
      ...this.shape(row, reviewerId), files: files.map((f: any) => ({ ...f, opened: opened.has(f.id) })),
      // For a T2 case "everything opened" means the documents and the video (the latest recording).
      allOpened: t2 ? files.every((f: any) => opened.has(f.id)) && t2.videoOpened : docsOpened,
      earlierDecision: earlier, decided: ['approved', 'rejected'].includes(outcome.status) ? outcome : null,
      ...(t2 ? { t2 } : {}),
    };
  }

  /** The id of the case that holds the evidence: an appeal reads the original case's recording. */
  private async evidenceCaseId(caseId: string): Promise<string> {
    return (await this.pool.query(`SELECT COALESCE(appeal_of, id) AS id FROM verification.cases WHERE id=$1`, [caseId])).rows[0].id;
  }

  /**
   * What the reviewer sees for a T2 case: the challenge, the window, the two readings against the property position, the hints
   * (advice only) and the latest recording. Earlier recordings of a "needs changes" round are listed but never opened.
   */
  private async t2Evidence(caseId: string, isAppeal: boolean, reviewerId: string) {
    const evCase = await this.evidenceCaseId(caseId);
    const all = (await this.pool.query(
      `SELECT e.attempt, e.challenge_id, e.video_file_id, e.submitted_at, e.start_lat, e.start_lon, e.start_accuracy_m, e.start_at, e.end_lat, e.end_lon, e.end_accuracy_m, e.end_at, e.hints,
              f.size_bytes::int AS size_bytes, f.mime_type, f.status AS file_status
         FROM verification.t2_evidence e JOIN supply.files f ON f.id = e.video_file_id WHERE e.case_id=$1 ORDER BY e.attempt`, [evCase])).rows;
    const latest = all[all.length - 1];
    if (!latest) return null;
    const ch = (await this.pool.query(`SELECT code, unit_ids, issued_at, expires_at FROM verification.t2_challenges WHERE id=$1`, [latest.challenge_id])).rows[0];
    const units = (await this.pool.query(`SELECT label FROM supply.units WHERE id = ANY($1::uuid[]) ORDER BY label`, [ch.unit_ids])).rows.map((u: any) => u.label);
    const pin = (await this.pool.query(
      `SELECT extensions.st_y(p.location::extensions.geometry) AS lat, extensions.st_x(p.location::extensions.geometry) AS lon FROM verification.cases c JOIN supply.properties p ON p.id = c.property_id WHERE c.id=$1`, [caseId])).rows[0];
    const seen = (await this.pool.query(`SELECT 1 FROM governance.data_access_log WHERE accessor_id=$1 AND resource='file:video' AND reason=$2 LIMIT 1`, [reviewerId, `case ${caseId} file ${latest.video_file_id}`])).rowCount! > 0;
    await this.pool.query(`INSERT INTO governance.data_access_log (accessor_id, resource, reason) VALUES ($1,'t2_evidence',$2)`, [reviewerId, `case ${caseId}`]);
    const h = latest.hints ?? {};
    const reading = (lat: any, lon: any, acc: any, at: any, d: any, band: any) => ({ lat: Number(lat), lon: Number(lon), accuracyM: Number(acc), at, distanceM: d ?? null, band: band ?? null });
    return {
      attempt: latest.attempt, attempts: all.map((a: any) => ({ attempt: a.attempt, submittedAt: a.submitted_at, flags: a.hints?.flags ?? [] })),
      isAppealOfRecording: isAppeal,
      challenge: { code: ch.code, units, issuedAt: ch.issued_at, expiresAt: ch.expires_at },
      window: { startedInside: new Date(latest.start_at) >= new Date(ch.issued_at) && new Date(latest.start_at) <= new Date(ch.expires_at), endedInside: h.endedBeforeExpiry ?? null, submittedAfterExpirySec: h.submittedAfterExpirySec ?? 0 },
      pin: pin?.lat == null ? null : { lat: Number(pin.lat), lon: Number(pin.lon) },
      start: reading(latest.start_lat, latest.start_lon, latest.start_accuracy_m, latest.start_at, h.startDistanceM, h.startBand),
      end: reading(latest.end_lat, latest.end_lon, latest.end_accuracy_m, latest.end_at, h.endDistanceM, h.endBand),
      readingsApartM: h.readingsApartM ?? null,
      hints: { flags: h.flags ?? [] },   // advice only: nothing here decides the case
      video: { sizeBytes: latest.size_bytes, mimeType: latest.mime_type, available: latest.file_status === 'ready' },
      videoOpened: seen,
      checklist: T2_CHECKLIST,
    };
  }

  /** A link that plays the latest recording of a T2 case for 5 minutes. Only the holder, always logged; watching it is required before an approval. */
  async openVideo(caseId: string, reviewerId: string) {
    if (!this.storage) throw new ServiceUnavailableException('File storage is not configured');
    const own = (await this.pool.query(`SELECT 1 FROM verification.cases WHERE id=$1 AND tier='t2' AND status='in_review' AND claimed_by=$2`, [caseId, reviewerId])).rowCount;
    if (!own) throw new NotFoundException('Video not found');
    const evCase = await this.evidenceCaseId(caseId);
    const v = (await this.pool.query(
      `SELECT f.id, f.storage_path, f.uploaded_by, f.mime_type FROM verification.t2_evidence e JOIN supply.files f ON f.id = e.video_file_id
        WHERE e.case_id=$1 AND f.status='ready' ORDER BY e.attempt DESC LIMIT 1`, [evCase])).rows[0];
    if (!v) throw new NotFoundException('Video not found');
    let url: string;
    try { url = await this.storage.createSignedDownload(v.storage_path, T2_VIDEO_LINK_SEC, v.mime_type?.includes('mp4') ? 'walkthrough.mp4' : 'walkthrough.webm'); }
    catch { throw new BadGatewayException('File storage is unavailable. Please try again.'); }
    await this.pool.query(`INSERT INTO governance.data_access_log (accessor_id, subject_user_id, resource, reason) VALUES ($1,$2,'file:video',$3)`, [reviewerId, v.uploaded_by ?? null, `case ${caseId} file ${v.id}`]);
    await this.audit.record({ actorId: reviewerId, action: 'verification.video_opened', subjectType: 'verification_case', subjectId: caseId, metadata: { fileId: v.id } });
    return { url, expiresInSec: T2_VIDEO_LINK_SEC };
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

  /** The human decision. Approve issues a T1 badge (12 months) or a T2 badge (6 months); the other two need a reason code. A T2 decision also records the six checklist answers. */
  async decide(caseId: string, reviewerId: string, body: { decision?: unknown; reasonCode?: unknown; note?: unknown; checklist?: unknown }) {
    // The tier decides which rules apply to the request. A case that does not exist is treated as T1 here and answers 404 below.
    const tier: string = (await this.pool.query(`SELECT tier FROM verification.cases WHERE id=$1`, [caseId])).rows[0]?.tier ?? 't1';
    const isT2 = tier === 't2';
    let checklist: Record<string, boolean> | null = null;
    if (isT2) { const v = checkT2Decision(body); if (v.error) throw new BadRequestException(v.error); checklist = v.checklist; }
    else { const bad = checkDecision(body); if (bad) throw new BadRequestException(bad); }
    const decision = body.decision as 'approve' | 'needs_changes' | 'reject';
    const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null;
    const reason = decision === 'approve' ? null : (body.reasonCode as string);
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const row = (await c.query(`SELECT id, org_id, property_id, tier, appeal_of, status, claimed_by, claimed_at, due_at, submitted_at, (SELECT count(*)::int FROM verification.case_files WHERE case_id=$1) AS files FROM verification.cases WHERE id=$1 FOR UPDATE`, [caseId])).rows[0];
      if (!row || row.claimed_by !== reviewerId) throw new NotFoundException('Case not found');
      if (row.status !== 'in_review') throw new ConflictException({ code: 'case_not_open', message: 'This case has already been decided.' });
      if (decision === 'approve') {
        const seen = (await c.query(`SELECT count(DISTINCT split_part(reason, ' file ', 2))::int n FROM governance.data_access_log WHERE accessor_id=$1 AND resource='file:document' AND reason LIKE $2`, [reviewerId, `case ${caseId} file %`])).rows[0].n;
        if (isT2) {
          const v = (await c.query(`SELECT video_file_id FROM verification.t2_evidence WHERE case_id=$1 ORDER BY attempt DESC LIMIT 1`, [row.appeal_of ?? row.id])).rows[0];
          if (!v) throw new UnprocessableEntityException({ code: 'no_evidence', message: 'This case has no recording to approve.' });
          const watched = (await c.query(`SELECT 1 FROM governance.data_access_log WHERE accessor_id=$1 AND resource='file:video' AND reason=$2 LIMIT 1`, [reviewerId, `case ${caseId} file ${v.video_file_id}`])).rowCount;
          if (!watched) throw new UnprocessableEntityException({ code: 'video_not_opened', message: 'Watch the video before approving.' });
          if (seen < row.files) throw new UnprocessableEntityException({ code: 'documents_not_opened', message: 'Open every attached document before approving.' });
        } else if (!row.files || seen < row.files) throw new UnprocessableEntityException({ code: 'documents_not_opened', message: 'Open every attached document before approving.' });
      }
      let badgeId: string | null = null;
      if (decision === 'approve') {
        const now = new Date();
        badgeId = (await c.query(`INSERT INTO verification.badges (subject_type, subject_id, level, verified_by, evidence_ref, issued_at, expires_at) VALUES ('property',$1,$6,$2,$3,$4,$5) RETURNING id`,
          [row.property_id, reviewerId, `case:${caseId}`, now, isT2 ? t2BadgeExpiry(now) : badgeExpiry(now), isT2 ? 't2_video' : 't1_documented'])).rows[0].id;
      }
      const status = decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'needs_changes';
      const final = decision !== 'needs_changes';
      try {
        await c.query(
          `UPDATE verification.cases SET status=$2, reason_code=$3, note=$4, badge_id=$5,
                  decided_by = CASE WHEN $6 THEN $7::uuid END, decided_at = CASE WHEN $6 THEN now() END,
                  paused_at = CASE WHEN $2='needs_changes' THEN now() END,
                  claimed_by = CASE WHEN $2='needs_changes' THEN NULL ELSE claimed_by END, claimed_at = CASE WHEN $2='needs_changes' THEN NULL ELSE claimed_at END,
                  t2_checklist = $8::jsonb
            WHERE id=$1`, [caseId, status, reason, note, badgeId, final, reviewerId, checklist ? JSON.stringify(checklist) : null]);
      } catch (e: any) {   // the database rules are the last line of defence: they refuse self-review and a repeat reviewer on an appeal
        const msg = String(e?.message);
        if (/reviewer|decider|different reviewer/.test(msg)) throw new NotFoundException('Case not found');
        if (/T2 needs a valid T1/.test(msg)) throw new ConflictException({ code: 't1_not_valid', message: 'The documented (T1) badge is no longer valid, so a video badge cannot be given. Choose Needs changes or Reject.' });
        if (/checklist item|T2 approval needs submitted evidence/.test(msg)) throw new UnprocessableEntityException({ code: 'checklist_incomplete', message: 'Every checklist item must be yes before approving.' });
        throw e;
      }
      await this.closeSession(c, caseId, reviewerId, row.claimed_at, final ? 'decided' : 'sent_back');
      await c.query(`INSERT INTO governance.audit_events (actor_id, action, subject_type, subject_id, metadata) VALUES ($1,$2,'verification_case',$3,$4)`,
        [reviewerId, `verification.${status}`, caseId, JSON.stringify({ propertyId: row.property_id, orgId: row.org_id, reasonCode: reason, badgeId, flagged: reason === 'suspected_forgery' || reason === 't2_suspected_replay', ...(isT2 ? { tier: 't2', checklist } : {}) })]);
      await c.query('COMMIT');
      return { id: caseId, status, reasonCode: reason, badgeId };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  }

  /** Active documented badges a reviewer may revoke (never those of an organisation they belong to), soonest to expire first. */
  async badges(reviewerId: string) {
    const rows = (await this.pool.query(
      `SELECT b.id, b.level, b.issued_at, b.expires_at, p.name AS property_name, p.address_text, o.name AS org_name,
              (b.level = 't1_documented' OR EXISTS (SELECT 1 FROM verification.property_badge_status s WHERE s.property_id = p.id AND s.t2_effective_until IS NOT NULL)) AS counts_now
         FROM verification.badges b JOIN supply.properties p ON p.id = b.subject_id JOIN identity.organizations o ON o.id = p.org_id
        WHERE b.subject_type='property' AND b.level IN ('t1_documented','t2_video') AND b.revoked_at IS NULL AND b.expires_at > now()
          AND NOT EXISTS (SELECT 1 FROM identity.memberships m WHERE m.user_id=$1 AND m.org_id = p.org_id)
        ORDER BY b.expires_at ASC LIMIT 200`, [reviewerId])).rows;
    await this.pool.query(`INSERT INTO governance.data_access_log (accessor_id, resource, reason) VALUES ($1,'verification_badge_list',$2)`, [reviewerId, `listed ${rows.length}`]);
    // "tier" tells T1 from T2; "suspended" is a T2 badge that does not count at the moment because its T1 has lapsed.
    return rows.map((r: any) => ({ id: r.id, tier: r.level === 't2_video' ? 't2' : 't1', suspended: !r.counts_now, propertyName: r.property_name, address: r.address_text, orgName: r.org_name, issuedAt: r.issued_at, expiresAt: r.expires_at }));
  }

  /** Withdraw a T1 or T2 badge. A reason code is mandatory; the property stops counting as verified at once. */
  async revoke(badgeId: string, reviewerId: string, body: { reasonCode?: unknown; note?: unknown }) {
    const level: string | undefined = (await this.pool.query(`SELECT level FROM verification.badges WHERE id=$1 AND subject_type='property'`, [badgeId])).rows[0]?.level;
    const isT2 = level === 't2_video';
    const bad = checkRevoke(body, isT2 ? T2_REASON_CODES : undefined); if (bad) throw new BadRequestException(bad);
    const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null;
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const row = (await c.query(
        `SELECT b.id, b.level, b.subject_id, p.org_id FROM verification.badges b JOIN supply.properties p ON p.id = b.subject_id
          WHERE b.id=$1 AND b.subject_type='property' AND b.level IN ('t1_documented','t2_video') AND b.revoked_at IS NULL AND b.expires_at > now() FOR UPDATE OF b`, [badgeId])).rows[0];
      const own = row && (await c.query('SELECT 1 FROM identity.memberships WHERE user_id=$1 AND org_id=$2', [reviewerId, row.org_id])).rowCount! > 0;
      if (!row || own) throw new NotFoundException('Badge not found');
      await c.query(`UPDATE verification.badges SET revoked_at=now(), revoke_reason_code=$2, revoke_note=$3 WHERE id=$1`, [badgeId, body.reasonCode, note]);
      await c.query(`INSERT INTO governance.audit_events (actor_id, action, subject_type, subject_id, metadata) VALUES ($1,'verification.badge_revoked','badge',$2,$3)`,
        [reviewerId, badgeId, JSON.stringify({ propertyId: row.subject_id, orgId: row.org_id, reasonCode: body.reasonCode, flagged: body.reasonCode === 'suspected_forgery' || body.reasonCode === 't2_suspected_replay', ...(row.level === 't2_video' ? { tier: 't2' } : {}) })]);
      await c.query('COMMIT');
      return { id: badgeId, revoked: true, reasonCode: body.reasonCode };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  }

  /** What this reviewer has decided or withdrawn, newest first. Built from the audit trail, so it can never disagree with it. */
  async history(reviewerId: string) {
    const rows = (await this.pool.query(
      `SELECT * FROM (
         SELECT a.occurred_at AS at, replace(a.action, 'verification.', '') AS kind, a.metadata->>'reasonCode' AS reason_code, c.id AS ref_id,
                c.appeal_of IS NOT NULL AS is_appeal, p.name AS property_name, o.name AS org_name, c.tier
           FROM governance.audit_events a
           JOIN verification.cases c ON c.id::text = a.subject_id
           JOIN supply.properties p ON p.id = c.property_id JOIN identity.organizations o ON o.id = c.org_id
          WHERE a.actor_id = $1 AND a.subject_type = 'verification_case' AND a.action IN ('verification.approved','verification.rejected','verification.needs_changes')
         UNION ALL
         SELECT a.occurred_at, 'badge_revoked', a.metadata->>'reasonCode', b.id, false, p.name, o.name, CASE b.level WHEN 't2_video' THEN 't2' ELSE 't1' END
           FROM governance.audit_events a
           JOIN verification.badges b ON b.id::text = a.subject_id
           JOIN supply.properties p ON p.id = b.subject_id JOIN identity.organizations o ON o.id = p.org_id
          WHERE a.actor_id = $1 AND a.subject_type = 'badge' AND a.action = 'verification.badge_revoked'
       ) h ORDER BY at DESC LIMIT 200`, [reviewerId])).rows;
    await this.pool.query(`INSERT INTO governance.data_access_log (accessor_id, resource, reason) VALUES ($1,'verification_history',$2)`, [reviewerId, `listed ${rows.length}`]);
    return rows.map((r: any) => ({ at: r.at, kind: r.kind, reasonCode: r.reason_code, id: r.ref_id, isAppeal: r.is_appeal, propertyName: r.property_name, orgName: r.org_name, tier: r.tier }));
  }
}
