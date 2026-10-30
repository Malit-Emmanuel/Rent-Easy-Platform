import { ConflictException, ForbiddenException, HttpException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { AuditService, PG_POOL } from '../audit/audit.service';
import { APPEAL_WINDOW_DAYS, T1_DEADLINE_WORKING_DAYS, addWorkingDays, canAppeal, missingProof, riskFlags } from './cases.rules';

/**
 * Manager side of T1 review. Everything is locked to the organisation in the URL.
 * Managers never see which reviewer decided: only the status, the reason code and the note.
 */
@Injectable()
export class CasesService {
  constructor(@Inject(PG_POOL) private pool: Pool, @Inject(AuditService) private audit: AuditService) {}

  private async property(orgId: string, propertyId: string, q: Pool | any = this.pool) {
    const r = (await q.query(`SELECT p.id, o.kind AS org_kind, o.created_at AS org_created FROM supply.properties p JOIN identity.organizations o ON o.id = p.org_id
                              WHERE p.id=$1 AND p.org_id=$2 AND p.archived_at IS NULL`, [propertyId, orgId])).rows[0];
    if (!r) throw new NotFoundException('Property not found');
    return r;
  }

  private async docs(propertyId: string, q: Pool | any = this.pool) {
    return (await q.query(`SELECT id, doc_type, ready_at FROM supply.files WHERE property_id=$1 AND kind='document' AND status='ready' ORDER BY created_at`, [propertyId])).rows as { id: string; doc_type: string; ready_at: Date }[];
  }

  /** Current verification picture of one property, for the manager. */
  async status(orgId: string, propertyId: string) {
    const prop = await this.property(orgId, propertyId);
    const cases = (await this.pool.query(
      `SELECT id, status, submitted_at, due_at, paused_at, decided_at, reason_code, note, appeal_of,
              EXISTS (SELECT 1 FROM verification.cases a WHERE a.appeal_of = c.id) AS has_appeal
         FROM verification.cases c WHERE property_id=$1 ORDER BY submitted_at DESC, id LIMIT 5`, [propertyId])).rows;
    const latest = cases[0] ?? null;
    const badge = (await this.pool.query(
      `SELECT expires_at FROM verification.badges WHERE subject_type='property' AND subject_id=$1 AND level='t1_documented' AND revoked_at IS NULL AND expires_at > now()
        ORDER BY expires_at DESC LIMIT 1`, [propertyId])).rows[0];
    const docTypes = (await this.docs(propertyId)).map((d) => d.doc_type);
    const missing = missingProof(docTypes, prop.org_kind);
    const open = latest && ['submitted', 'in_review', 'needs_changes'].includes(latest.status);
    return {
      verified: !!badge, verifiedUntil: badge?.expires_at ?? null,
      case: latest && {
        id: latest.id, status: latest.status, submittedAt: latest.submitted_at, dueAt: latest.due_at, paused: !!latest.paused_at,
        decidedAt: latest.decided_at, reasonCode: latest.reason_code, note: latest.note, isAppeal: !!latest.appeal_of,
        canResubmit: latest.status === 'needs_changes',
        canAppeal: canAppeal({ status: latest.status, decidedAt: latest.decided_at, appealOf: latest.appeal_of, hasAppeal: latest.has_appeal }, new Date()),
      },
      missingProof: missing, canRequest: !badge && !open,
      appealWindowDays: APPEAL_WINDOW_DAYS,
    };
  }

  private async requireIdVerified(userId: string) {
    const b = (await this.pool.query(`SELECT 1 FROM verification.badges WHERE subject_type='user' AND subject_id=$1 AND level='id_verified' AND revoked_at IS NULL AND expires_at > now() LIMIT 1`, [userId])).rows[0];
    if (!b) throw new ForbiddenException({ code: 'id_not_verified', message: 'Complete your ID verification before requesting property verification.' });
  }

  private async create(orgId: string, propertyId: string, userId: string, appealOf: string | null) {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const prop = await this.property(orgId, propertyId, c);
      await c.query('SELECT 1 FROM supply.properties WHERE id=$1 FOR UPDATE', [propertyId]);       // serialise requests for this property
      const docs = await this.docs(propertyId, c);
      const missing = missingProof(docs.map((d) => d.doc_type), prop.org_kind);
      if (missing.length) throw new HttpException({ code: 'proof_missing', message: 'Upload the required documents first.', missing }, 422);
      const prior = (await c.query(`SELECT count(*)::int n FROM verification.cases WHERE property_id=$1 AND status='rejected'`, [propertyId])).rows[0].n;
      const now = new Date();
      const flags = riskFlags({
        orgAgeDays: (now.getTime() - new Date(prop.org_created).getTime()) / 86_400_000, priorRejections: prior, docTypes: docs.map((d) => d.doc_type),
        newestDocAgeMinutes: Math.min(...docs.map((d) => (now.getTime() - new Date(d.ready_at).getTime()) / 60_000)), isAppeal: !!appealOf,
      });
      let row;
      try {
        row = (await c.query(`INSERT INTO verification.cases (org_id, property_id, submitted_by, due_at, appeal_of, risk_flags) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, status, due_at`,
          [orgId, propertyId, userId, addWorkingDays(now, T1_DEADLINE_WORKING_DAYS), appealOf, flags])).rows[0];
      } catch (e: any) {
        if (e.code === '23505') throw new ConflictException('This property already has a case in progress');
        throw e;
      }
      for (const d of docs) await c.query('INSERT INTO verification.case_files (case_id, file_id) VALUES ($1,$2)', [row.id, d.id]);
      await c.query('COMMIT');
      await this.audit.record({ actorId: userId, action: appealOf ? 'verification.appealed' : 'verification.requested', subjectType: 'verification_case', subjectId: row.id, metadata: { orgId, propertyId, documents: docs.length } });
      return { caseId: row.id, status: row.status, dueAt: row.due_at };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  }

  async request(orgId: string, propertyId: string, userId: string) {
    await this.property(orgId, propertyId);
    await this.requireIdVerified(userId);
    const valid = (await this.pool.query(`SELECT 1 FROM verification.badges WHERE subject_type='property' AND subject_id=$1 AND level='t1_documented' AND revoked_at IS NULL AND expires_at > now() LIMIT 1`, [propertyId])).rows[0];
    if (valid) throw new ConflictException('This property is already verified');
    return this.create(orgId, propertyId, userId, null);
  }

  async appeal(orgId: string, propertyId: string, userId: string) {
    await this.property(orgId, propertyId);
    await this.requireIdVerified(userId);
    const last = (await this.pool.query(
      `SELECT id, status, decided_at, appeal_of, EXISTS (SELECT 1 FROM verification.cases a WHERE a.appeal_of = c.id) AS has_appeal
         FROM verification.cases c WHERE property_id=$1 ORDER BY submitted_at DESC, id LIMIT 1`, [propertyId])).rows[0];
    if (!last || !canAppeal({ status: last.status, decidedAt: last.decided_at, appealOf: last.appeal_of, hasAppeal: last.has_appeal }, new Date()))
      throw new ConflictException('There is no rejected case that can be appealed');
    return this.create(orgId, propertyId, userId, last.id);
  }

  /** After "needs changes": the manager has added or fixed documents and sends the same case back. The review clock resumes with the time that was left. */
  async resubmit(orgId: string, propertyId: string, userId: string) {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const prop = await this.property(orgId, propertyId, c);
      await c.query('SELECT 1 FROM supply.properties WHERE id=$1 FOR UPDATE', [propertyId]);
      const cur = (await c.query(`SELECT id, due_at, paused_at FROM verification.cases WHERE property_id=$1 AND status='needs_changes' FOR UPDATE`, [propertyId])).rows[0];
      if (!cur) throw new ConflictException({ code: 'nothing_to_resubmit', message: 'There is no request waiting for changes.' });
      const docs = await this.docs(propertyId, c);
      const missing = missingProof(docs.map((d) => d.doc_type), prop.org_kind);
      if (missing.length) throw new HttpException({ code: 'proof_missing', message: 'Upload the required documents first.', missing }, 422);
      const left = Math.max(new Date(cur.due_at).getTime() - new Date(cur.paused_at ?? Date.now()).getTime(), 3_600_000);
      await c.query(`INSERT INTO verification.case_files (case_id, file_id) SELECT $1, id FROM supply.files WHERE property_id=$2 AND kind='document' AND status='ready' ON CONFLICT DO NOTHING`, [cur.id, propertyId]);
      const due = new Date(Date.now() + left);
      await c.query(`UPDATE verification.cases SET status='submitted', paused_at=NULL, reason_code=NULL, note=NULL, due_at=$2, submitted_at=LEAST(submitted_at, now() - interval '1 second') WHERE id=$1`, [cur.id, due]);
      await c.query(`INSERT INTO governance.audit_events (actor_id, action, subject_type, subject_id, metadata) VALUES ($1,'verification.resubmitted','verification_case',$2,$3)`, [userId, cur.id, JSON.stringify({ propertyId, orgId })]);
      await c.query('COMMIT');
      return { caseId: cur.id, status: 'submitted', dueAt: due };
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  }
}
