import { BadGatewayException, BadRequestException, ConflictException, ForbiddenException, HttpException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { AuditService, PG_POOL } from '../audit/audit.service';
import { checkFileRequest, storagePath } from '../supply/files/files.rules';
import { STORAGE_PORT, StoragePort } from '../supply/files/storage.port';
import { RENEWAL_WINDOW_DAYS, addWorkingDays, canAppeal } from './cases.rules';
import {
  CHALLENGE_MINUTES, MAX_TAKES, SAME_SPOT_M, T2_DEADLINE_WORKING_DAYS, UPLOAD_GRACE_MINUTES,
  checkConsent, checkReadings, computeHints, haversineM, newCode, pickUnits, t2Enabled, t2QueueFlags, unitsToShow,
} from './t2.rules';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REFUSED = 'This recording cannot be accepted. Please request a new challenge and record again.';

/**
 * Manager side of T2 (video and location). Everything is locked to the organisation in the URL, and a challenge can be used only by
 * the person who received it. The computed hints are stored for the reviewer and are never shown to the manager.
 */
@Injectable()
export class T2Service {
  constructor(@Inject(PG_POOL) private pool: Pool, @Inject(AuditService) private audit: AuditService, @Inject(STORAGE_PORT) private storage: StoragePort | null) {}

  private requireEnabled() {
    if (!t2Enabled()) throw new ForbiddenException({ code: 't2_disabled', message: 'Video verification is not available yet.' });
  }
  private store(): StoragePort {
    if (!this.storage) throw new ServiceUnavailableException('File storage is not configured');
    return this.storage;
  }
  private async property(orgId: string, propertyId: string, q: Pool | any = this.pool) {
    const r = (await q.query(
      `SELECT p.id, extensions.st_y(p.location::extensions.geometry) AS lat, extensions.st_x(p.location::extensions.geometry) AS lon
         FROM supply.properties p WHERE p.id=$1 AND p.org_id=$2 AND p.archived_at IS NULL`, [propertyId, orgId])).rows[0];
    if (!r) throw new NotFoundException('Property not found');
    return r as { id: string; lat: number | null; lon: number | null };
  }
  private async idVerified(userId: string) {
    return (await this.pool.query(`SELECT 1 FROM verification.badges WHERE subject_type='user' AND subject_id=$1 AND level='id_verified' AND revoked_at IS NULL AND expires_at > now() LIMIT 1`, [userId])).rowCount! > 0;
  }
  private async docs(propertyId: string, q: Pool | any) {
    return (await q.query(`SELECT id FROM supply.files WHERE property_id=$1 AND kind='document' AND status='ready' ORDER BY created_at`, [propertyId])).rows as { id: string }[];
  }

  /** What the manager sees on the T2 part of the Verification card. */
  async status(orgId: string, propertyId: string, userId: string) {
    const prop = await this.property(orgId, propertyId);
    const [t1, t2, open, ch, last, idOk, ended] = await Promise.all([
      this.pool.query(`SELECT expires_at FROM verification.badges WHERE subject_type='property' AND subject_id=$1 AND level='t1_documented' AND revoked_at IS NULL AND expires_at > now() LIMIT 1`, [propertyId]),
      this.pool.query(`SELECT expires_at FROM verification.badges WHERE subject_type='property' AND subject_id=$1 AND level='t2_video' AND revoked_at IS NULL AND expires_at > now() ORDER BY expires_at DESC LIMIT 1`, [propertyId]),
      this.pool.query(`SELECT 1 FROM verification.cases WHERE property_id=$1 AND status IN ('submitted','in_review') LIMIT 1`, [propertyId]),
      this.pool.query(`SELECT id, requested_by, code, unit_ids, issued_at, expires_at, takes FROM verification.t2_challenges WHERE property_id=$1 AND used_at IS NULL AND expires_at > now() ORDER BY issued_at DESC LIMIT 1`, [propertyId]),
      this.pool.query(
        `SELECT id, status, due_at, paused_at, decided_at, reason_code, note, appeal_of, submitted_at,
                EXISTS (SELECT 1 FROM verification.cases a WHERE a.appeal_of = c.id) AS has_appeal,
                (SELECT count(*)::int FROM verification.t2_evidence e WHERE e.case_id = COALESCE(c.appeal_of, c.id)) AS attempts
           FROM verification.cases c WHERE property_id=$1 AND tier='t2' ORDER BY submitted_at DESC, id LIMIT 1`, [propertyId]),
      this.idVerified(userId),
      this.pool.query(`SELECT revoked_at, expires_at, revoke_reason_code, revoke_note FROM verification.badges WHERE subject_type='property' AND subject_id=$1 AND level='t2_video' ORDER BY issued_at DESC LIMIT 1`, [propertyId]),
    ]);
    const lastCase = last.rows[0] ?? null;
    const otherOpen = (open.rowCount ?? 0) > 0;
    const t1Case = (await this.pool.query(`SELECT 1 FROM verification.cases WHERE property_id=$1 AND tier='t1' AND status='needs_changes' LIMIT 1`, [propertyId])).rowCount! > 0;
    const blockers: string[] = [];
    if (!t2Enabled()) blockers.push('t2_disabled');
    if (!idOk) blockers.push('id_not_verified');
    if (!t1.rowCount) blockers.push('no_valid_t1');
    if (prop.lat === null) blockers.push('no_position');
    if (otherOpen || t1Case) blockers.push('case_open');
    // A valid video badge blocks a new request, except in its last 30 days (renewal), so there is no gap.
    const t2Expiry: Date | null = t2.rows[0] ? new Date(t2.rows[0].expires_at) : null;
    const renewable = !!t2Expiry && t2Expiry.getTime() - Date.now() <= RENEWAL_WINDOW_DAYS * 86_400_000;
    if (t2.rowCount && t1.rowCount && !renewable) blockers.push('already_t2');
    const e = ended.rows[0];
    const badgeEnded = !t2.rowCount && e && (e.revoked_at || new Date(e.expires_at) <= new Date())
      ? { kind: e.revoked_at ? 'revoked' : 'expired', on: e.revoked_at ?? e.expires_at, reasonCode: e.revoke_reason_code ?? null, note: e.revoke_note ?? null } : null;
    let challenge: any = null;
    const c = ch.rows[0];
    if (c) {
      const mine = c.requested_by === userId;
      const units = mine ? (await this.pool.query(`SELECT id, label FROM supply.units WHERE id = ANY($1::uuid[]) ORDER BY label`, [c.unit_ids])).rows : [];
      challenge = { id: c.id, mine, issuedAt: c.issued_at, expiresAt: c.expires_at, takesUsed: c.takes, takesLeft: MAX_TAKES - c.takes, ...(mine ? { code: c.code, unitsToShow: units } : {}) };
    }
    return {
      now: new Date().toISOString(),   // lets the phone correct for a wrong clock when it stamps its location readings
      enabled: t2Enabled(), eligible: blockers.length === 0 && !challenge, blockers,
      // A video badge counts only while the documented (T1) badge is valid, and only until the earlier of the two ends.
      badge: t2Expiry && t1.rows[0] ? { validUntil: new Date(Math.min(t2Expiry.getTime(), new Date(t1.rows[0].expires_at).getTime())).toISOString(), ownExpiry: t2Expiry.toISOString(), renewable } : null,
      suspended: t2Expiry && !t1.rows[0] ? { validUntil: t2Expiry.toISOString() } : null,
      badgeEnded,
      challenge,
      case: lastCase && {
        id: lastCase.id, status: lastCase.status, submittedAt: lastCase.submitted_at, dueAt: lastCase.due_at, paused: !!lastCase.paused_at, decidedAt: lastCase.decided_at,
        reasonCode: lastCase.reason_code, note: lastCase.note, isAppeal: !!lastCase.appeal_of, attempts: lastCase.attempts,
        needsNewRecording: lastCase.status === 'needs_changes',
        canAppeal: canAppeal({ status: lastCase.status, decidedAt: lastCase.decided_at, appealOf: lastCase.appeal_of, hasAppeal: lastCase.has_appeal }, new Date()),
      },
      limits: { windowMinutes: CHALLENGE_MINUTES, maxTakes: MAX_TAKES },
    };
  }

  /** Step 1: the manager agrees to the notice and receives a code and the unit(s) to show. */
  async issueChallenge(orgId: string, propertyId: string, userId: string, body: unknown) {
    this.requireEnabled();
    const bad = checkConsent(body); if (bad) throw new BadRequestException(bad);
    await this.property(orgId, propertyId);
    if (!(await this.idVerified(userId))) throw new ForbiddenException({ code: 'id_not_verified', message: 'Complete your ID verification before requesting property verification.' });
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const prop = await this.property(orgId, propertyId, c);
      await c.query('SELECT 1 FROM supply.properties WHERE id=$1 FOR UPDATE', [propertyId]);       // serialise requests for this property
      if (prop.lat === null) throw new HttpException({ code: 'no_position', message: 'Set the property position on the map first.' }, 422);
      if (!(await c.query(`SELECT 1 FROM verification.badges WHERE subject_type='property' AND subject_id=$1 AND level='t1_documented' AND revoked_at IS NULL AND expires_at > now()`, [propertyId])).rowCount)
        throw new HttpException({ code: 'no_valid_t1', message: 'The property needs a valid document verification (T1) first.' }, 422);
      if (await c.query(`SELECT 1 FROM verification.badges WHERE subject_type='property' AND subject_id=$1 AND level='t2_video' AND revoked_at IS NULL AND expires_at > now() + make_interval(days => $2)`, [propertyId, RENEWAL_WINDOW_DAYS]).then((r) => r.rowCount))
        throw new ConflictException({ code: 'already_t2', message: 'This property already has a video verification.' });
      if (await c.query(`SELECT 1 FROM verification.cases WHERE property_id=$1 AND (status IN ('submitted','in_review') OR (status='needs_changes' AND tier <> 't2'))`, [propertyId]).then((r) => r.rowCount))
        throw new ConflictException({ code: 'case_open', message: 'This property already has a verification in progress.' });
      if (await c.query(`SELECT 1 FROM verification.t2_challenges WHERE property_id=$1 AND used_at IS NULL AND expires_at > now()`, [propertyId]).then((r) => r.rowCount))
        throw new ConflictException({ code: 'challenge_active', message: 'A recording challenge is already active for this property. Open it from the Verification card, or wait for it to expire.' });
      const units = (await c.query(`SELECT id FROM supply.units WHERE property_id=$1 AND archived_at IS NULL ORDER BY id`, [propertyId])).rows.map((r: any) => r.id as string);
      if (!units.length) throw new HttpException({ code: 'no_units', message: 'Add at least one unit to the property first.' }, 422);
      const chosen = pickUnits(units, unitsToShow(units.length));
      const code = newCode();
      const row = (await c.query(
        `INSERT INTO verification.t2_challenges (org_id, property_id, requested_by, code, unit_ids, consent_at, expires_at)
         VALUES ($1,$2,$3,$4,$5, now(), now() + make_interval(mins => $6)) RETURNING id, issued_at, expires_at`,
        [orgId, propertyId, userId, code, chosen, CHALLENGE_MINUTES])).rows[0];
      const labels = (await c.query(`SELECT id, label FROM supply.units WHERE id = ANY($1::uuid[]) ORDER BY label`, [chosen])).rows;
      await c.query(`INSERT INTO governance.audit_events (actor_id, action, subject_type, subject_id, metadata) VALUES ($1,'verification.t2_challenge_issued','t2_challenge',$2,$3)`,
        [userId, row.id, JSON.stringify({ orgId, propertyId, units: chosen.length })]);
      await c.query('COMMIT');
      return { now: new Date().toISOString(), id: row.id, code, unitsToShow: labels, issuedAt: row.issued_at, expiresAt: row.expires_at, takesUsed: 0, takesLeft: MAX_TAKES };
    } catch (e: any) {
      await c.query('ROLLBACK').catch(() => {});
      if (e?.code === 'P0001') throw new ConflictException({ code: 'challenge_refused', message: 'A challenge cannot be issued for this property right now.' });
      throw e;
    } finally { c.release(); }
  }

  /** Step 2: start one recording (up to three). Earlier unsubmitted takes of this challenge are discarded. The browser then uploads and calls the usual file "complete" step. */
  async startTake(orgId: string, propertyId: string, challengeId: string, userId: string, body: any) {
    this.requireEnabled();
    const store = this.store();
    const req = checkFileRequest({ kind: 'video', mimeType: body?.mimeType, sizeBytes: body?.sizeBytes });
    if (req.errors.length) throw new BadRequestException(req.errors.join('; '));
    await this.property(orgId, propertyId);
    const fileId = randomUUID(), path = storagePath(orgId, propertyId, fileId, req.value.mimeType);
    let upload;
    try { upload = await store.createSignedUpload(path, req.value.mimeType); } catch { throw new BadGatewayException('File storage is unavailable. Please try again.'); }
    const c = await this.pool.connect(); let discarded: string[] = []; let take = 0;
    try {
      await c.query('BEGIN');
      const ch = (await c.query(
        `SELECT id, takes, used_at, expires_at FROM verification.t2_challenges WHERE id=$1 AND org_id=$2 AND property_id=$3 AND requested_by=$4 FOR UPDATE`, [challengeId, orgId, propertyId, userId])).rows[0];
      if (!ch) throw new NotFoundException('Challenge not found');
      if (ch.used_at || new Date(ch.expires_at).getTime() <= Date.now()) throw new ConflictException({ code: 'challenge_expired', message: 'This challenge has ended. Request a new one.' });
      if (ch.takes >= MAX_TAKES) throw new ConflictException({ code: 'takes_used', message: 'All three recordings of this challenge have been used. Request a new one after it expires.' });
      const old = (await c.query(
        `UPDATE supply.files f SET status='deleted', deleted_at=now() FROM verification.t2_takes t WHERE t.challenge_id=$1 AND t.file_id=f.id AND f.status IN ('ready','pending') RETURNING f.storage_path`, [challengeId])).rows;
      discarded = old.map((r: any) => r.storage_path);
      take = (await c.query(`UPDATE verification.t2_challenges SET takes = takes + 1 WHERE id=$1 RETURNING takes`, [challengeId])).rows[0].takes;
      await c.query(
        `INSERT INTO supply.files (id, org_id, property_id, unit_id, kind, doc_type, storage_path, original_name, mime_type, size_bytes, uploaded_by)
         VALUES ($1,$2,$3,NULL,'video',NULL,$4,NULL,$5,$6,$7)`, [fileId, orgId, propertyId, path, req.value.mimeType, req.value.sizeBytes, userId]);
      await c.query(`INSERT INTO verification.t2_takes (file_id, challenge_id, take_no) VALUES ($1,$2,$3)`, [fileId, challengeId, take]);
      await c.query(`INSERT INTO governance.audit_events (actor_id, action, subject_type, subject_id, metadata) VALUES ($1,'verification.t2_take_started','t2_challenge',$2,$3)`,
        [userId, challengeId, JSON.stringify({ orgId, propertyId, take })]);
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
    for (const p of discarded) await store.remove(p).catch(() => {});       // "only the submitted take is kept"
    return { fileId, take, takesLeft: MAX_TAKES - take, upload };
  }

  /** Step 3: the recording is uploaded and checked. Creates the T2 case (or sends the "needs changes" case back) with the two location readings. */
  async submit(orgId: string, propertyId: string, userId: string, body: any) {
    this.requireEnabled();
    const store = this.store();
    const challengeId = body?.challengeId, fileId = body?.fileId;
    if (typeof challengeId !== 'string' || !UUID.test(challengeId) || typeof fileId !== 'string' || !UUID.test(fileId)) throw new BadRequestException('challengeId and fileId are required');
    const now = new Date();
    const rd = checkReadings(body, now); if (rd.errors.length) throw new BadRequestException(rd.errors.join('; '));
    const { start, end } = rd as { start: NonNullable<typeof rd.start>; end: NonNullable<typeof rd.end> };
    await this.property(orgId, propertyId);
    const row = (await this.pool.query(
      `SELECT ch.id, ch.issued_at, ch.expires_at, ch.used_at, f.storage_path, f.status AS file_status
         FROM verification.t2_challenges ch JOIN verification.t2_takes t ON t.challenge_id = ch.id AND t.file_id = $5 JOIN supply.files f ON f.id = t.file_id
        WHERE ch.id=$1 AND ch.org_id=$2 AND ch.property_id=$3 AND ch.requested_by=$4`, [challengeId, orgId, propertyId, userId, fileId])).rows[0];
    if (!row) throw new NotFoundException('Recording not found');
    if (row.used_at) throw new ConflictException({ code: 'challenge_used', message: 'This challenge has already been used.' });
    if (row.file_status !== 'ready') throw new ConflictException({ code: 'upload_not_complete', message: 'The recording has not finished uploading.' });
    const issued = new Date(row.issued_at), expires = new Date(row.expires_at);
    if (Date.now() > expires.getTime() + UPLOAD_GRACE_MINUTES * 60_000) throw new ConflictException({ code: 'challenge_expired', message: 'This challenge has ended. Request a new one.' });
    if (start.at < issued || start.at > expires) throw new HttpException({ code: 'recording_outside_window', message: 'The recording must be made inside the challenge window.' }, 422);
    let sha: Buffer | null;
    try { sha = await store.sha256(row.storage_path); } catch { throw new BadGatewayException('File storage is unavailable. Please try again.'); }
    if (!sha) throw new ConflictException({ code: 'upload_not_complete', message: 'The recording has not finished uploading.' });

    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const prop = await this.property(orgId, propertyId, c);
      await c.query('SELECT 1 FROM supply.properties WHERE id=$1 FOR UPDATE', [propertyId]);
      if (prop.lat === null) throw new HttpException({ code: 'no_position', message: 'Set the property position on the map first.' }, 422);
      const cur = (await c.query(`SELECT id, status, tier, due_at, paused_at FROM verification.cases WHERE property_id=$1 AND status IN ('submitted','in_review','needs_changes') FOR UPDATE`, [propertyId])).rows[0];
      if (cur && !(cur.tier === 't2' && cur.status === 'needs_changes')) throw new ConflictException({ code: 'case_open', message: 'This property already has a verification in progress.' });

      const sameVideo = (await c.query(`SELECT count(*)::int n FROM verification.t2_evidence WHERE video_sha256 = $1`, [sha])).rows[0].n;
      const near = (await c.query(
        `SELECT e.start_lat, e.start_lon, e.end_lat, e.end_lon, cs.property_id FROM verification.t2_evidence e JOIN verification.cases cs ON cs.id = e.case_id
          WHERE cs.property_id <> $1 AND ((abs(e.start_lat - $2) < 0.0002 AND abs(e.start_lon - $3) < 0.0002) OR (abs(e.end_lat - $4) < 0.0002 AND abs(e.end_lon - $5) < 0.0002))`,
        [propertyId, start.lat, start.lon, end.lat, end.lon])).rows;
      const otherProps = new Set(near.filter((r: any) =>
        haversineM(start, { lat: Number(r.start_lat), lon: Number(r.start_lon) }) <= SAME_SPOT_M || haversineM(end, { lat: Number(r.end_lat), lon: Number(r.end_lon) }) <= SAME_SPOT_M
        || haversineM(start, { lat: Number(r.end_lat), lon: Number(r.end_lon) }) <= SAME_SPOT_M || haversineM(end, { lat: Number(r.start_lat), lon: Number(r.start_lon) }) <= SAME_SPOT_M).map((r: any) => r.property_id));
      const hints = computeHints({
        pin: { lat: Number(prop.lat), lon: Number(prop.lon) }, start, end, challenge: { issuedAt: issued, expiresAt: expires }, submittedAt: new Date(),
        sameVideoElsewhere: sameVideo, samePlaceOtherProperties: otherProps.size,
      });
      const priorRejections = (await c.query(`SELECT count(*)::int n FROM verification.cases WHERE property_id=$1 AND tier='t2' AND status='rejected'`, [propertyId])).rows[0].n;
      const flags = t2QueueFlags(hints, priorRejections > 0 ? ['previously_rejected'] : []);

      let caseId: string, dueAt: Date, attempt: number;
      if (cur) {
        caseId = cur.id;
        attempt = (await c.query(`SELECT coalesce(max(attempt),0)::int + 1 AS n FROM verification.t2_evidence WHERE case_id=$1`, [caseId])).rows[0].n;
      } else {
        dueAt = addWorkingDays(new Date(), T2_DEADLINE_WORKING_DAYS);
        const created = (await c.query(`INSERT INTO verification.cases (org_id, property_id, tier, submitted_by, due_at, risk_flags) VALUES ($1,$2,'t2',$3,$4,$5) RETURNING id`, [orgId, propertyId, userId, dueAt, flags])).rows[0];
        caseId = created.id; attempt = 1;
        for (const d of await this.docs(propertyId, c)) await c.query('INSERT INTO verification.case_files (case_id, file_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [caseId, d.id]);
      }
      await c.query(
        `INSERT INTO verification.t2_evidence (case_id, attempt, challenge_id, video_file_id, video_sha256, start_lat, start_lon, start_accuracy_m, start_at, end_lat, end_lon, end_accuracy_m, end_at, hints)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [caseId, attempt, challengeId, fileId, sha, start.lat, start.lon, start.accuracyM, start.at, end.lat, end.lon, end.accuracyM, end.at, JSON.stringify(hints)]);
      if (cur) {
        const left = Math.max(new Date(cur.due_at).getTime() - new Date(cur.paused_at ?? Date.now()).getTime(), 3_600_000);
        dueAt = new Date(Date.now() + left);
        await c.query(`UPDATE verification.cases SET status='submitted', paused_at=NULL, reason_code=NULL, note=NULL, t2_checklist=NULL, due_at=$2, risk_flags=$3, submitted_at=LEAST(submitted_at, now() - interval '1 second') WHERE id=$1`, [caseId, dueAt, flags]);
      }
      await c.query(`INSERT INTO governance.audit_events (actor_id, action, subject_type, subject_id, metadata) VALUES ($1,$2,'verification_case',$3,$4)`,
        [userId, cur ? 'verification.t2_resubmitted' : 'verification.t2_submitted', caseId, JSON.stringify({ orgId, propertyId, attempt, hintFlags: hints.flags.length })]);
      await c.query('COMMIT');
      return { caseId, status: 'submitted', dueAt: dueAt!, attempt };
    } catch (e: any) {
      await c.query('ROLLBACK').catch(() => {});
      if (e?.code === 'P0001') throw new ConflictException({ code: 'evidence_refused', message: REFUSED });
      if (e?.code === '23505') throw new ConflictException({ code: 'challenge_used', message: 'This challenge has already been used.' });
      throw e;
    } finally { c.release(); }
  }

  /** One appeal of a rejected T2 case. The new case reads the original's evidence; no new recording is made. */
  async appeal(orgId: string, propertyId: string, userId: string) {
    this.requireEnabled();
    await this.property(orgId, propertyId);
    if (!(await this.idVerified(userId))) throw new ForbiddenException({ code: 'id_not_verified', message: 'Complete your ID verification before requesting property verification.' });
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SELECT 1 FROM supply.properties WHERE id=$1 FOR UPDATE', [propertyId]);
      const last = (await c.query(
        `SELECT id, status, decided_at, appeal_of, EXISTS (SELECT 1 FROM verification.cases a WHERE a.appeal_of = c.id) AS has_appeal
           FROM verification.cases c WHERE property_id=$1 AND tier='t2' ORDER BY submitted_at DESC, id LIMIT 1`, [propertyId])).rows[0];
      if (!last || !canAppeal({ status: last.status, decidedAt: last.decided_at, appealOf: last.appeal_of, hasAppeal: last.has_appeal }, new Date()))
        throw new ConflictException('There is no rejected video verification that can be appealed');
      const created = (await c.query(
        `INSERT INTO verification.cases (org_id, property_id, tier, submitted_by, due_at, appeal_of, risk_flags) VALUES ($1,$2,'t2',$3,$4,$5,$6) RETURNING id, due_at`,
        [orgId, propertyId, userId, addWorkingDays(new Date(), T2_DEADLINE_WORKING_DAYS), last.id, ['t2', 'appeal']])).rows[0];
      for (const d of await this.docs(propertyId, c)) await c.query('INSERT INTO verification.case_files (case_id, file_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [created.id, d.id]);
      await c.query(`INSERT INTO governance.audit_events (actor_id, action, subject_type, subject_id, metadata) VALUES ($1,'verification.t2_appealed','verification_case',$2,$3)`, [userId, created.id, JSON.stringify({ orgId, propertyId })]);
      await c.query('COMMIT');
      return { caseId: created.id, status: 'submitted', dueAt: created.due_at };
    } catch (e: any) {
      await c.query('ROLLBACK').catch(() => {});
      if (e?.code === '23505') throw new ConflictException('This property already has a case in progress');
      if (e?.code === 'P0001') throw new ConflictException({ code: 'appeal_refused', message: 'This appeal cannot be started right now.' });
      throw e;
    } finally { c.release(); }
  }
}
