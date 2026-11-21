import { BadRequestException, ConflictException, HttpException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { AuditService, PG_POOL } from '../audit/audit.service';

const KINDS = ['correction', 'deletion'];
const MAX_EXPORTS_PER_HOUR = 5;
const DOCS = ['privacy', 'terms'] as const;
type Doc = (typeof DOCS)[number];
const VERSION_RE = /^[A-Za-z0-9._-]{1,40}$/;
/** The version in force for a document, set by the operator once the lawyer approves the text. Unset means nothing is required. Read on each call so a change needs no restart. */
const currentVersion = (doc: Doc): string | undefined => { const v = (process.env[doc === 'privacy' ? 'POLICY_PRIVACY_VERSION' : 'POLICY_TERMS_VERSION'] ?? '').trim(); return VERSION_RE.test(v) ? v : undefined; };

/**
 * People's rights over their own data. This slice only reads (the export) and records (requests).
 * It never deletes or edits personal data: a request is decided by a person, and any deletion is done by hand after counsel's advice.
 */
@Injectable()
export class PrivacyService {
  constructor(@Inject(PG_POOL) private pool: Pool, @Inject(AuditService) private audit: AuditService) {}

  /** Everything the platform holds about the signed-in person, in one document. Nothing about anyone else. */
  async exportMine(userId: string) {
    const n = (await this.pool.query(`SELECT count(*)::int n FROM governance.audit_events WHERE actor_id=$1 AND action='privacy.export_downloaded' AND occurred_at > now() - interval '1 hour'`, [userId])).rows[0].n;
    if (n >= MAX_EXPORTS_PER_HOUR) throw new HttpException('You have downloaded your data several times in the last hour. Try again later.', 429);
    const q = async (sql: string) => (await this.pool.query(sql, [userId])).rows;
    const [profile] = await q(`SELECT id, phone, full_name AS "fullName", locale, status, created_at AS "createdAt" FROM identity.users WHERE id=$1`);
    if (!profile) throw new NotFoundException('Account not found');
    const data = {
      generatedAt: new Date().toISOString(),
      about: 'This is the personal data Edupato Homes holds about you. It lists what is recorded, not the files themselves.',
      profile,
      roles: (await q(`SELECT role FROM identity.platform_roles WHERE user_id=$1 ORDER BY role`)).map((r) => r.role),
      organisations: await q(`SELECT o.name, o.kind, m.role, m.created_at AS "joinedAt" FROM identity.memberships m JOIN identity.organizations o ON o.id = m.org_id WHERE m.user_id=$1 ORDER BY m.created_at`),
      uploads: await q(`SELECT f.id, f.kind, f.doc_type AS "docType", f.original_name AS "fileName", f.mime_type AS "mimeType", f.size_bytes AS "sizeBytes", f.status, p.name AS "property", f.created_at AS "uploadedAt", f.deleted_at AS "deletedAt"
                          FROM supply.files f JOIN supply.properties p ON p.id = f.property_id WHERE f.uploaded_by=$1 ORDER BY f.created_at`),
      verificationCases: await q(`SELECT c.id, p.name AS "property", c.tier, c.status, c.submitted_at AS "submittedAt", c.decided_at AS "decidedAt", c.reason_code AS "reasonCode", c.note, c.appeal_of AS "appealOf"
                                    FROM verification.cases c JOIN supply.properties p ON p.id = c.property_id WHERE c.submitted_by=$1 ORDER BY c.submitted_at`),
      identityChecks: await q(`SELECT provider, status, reason_code AS "reasonCode", created_at AS "startedAt", completed_at AS "completedAt" FROM identity.verification_sessions WHERE user_id=$1 ORDER BY created_at`),
      consents: await q(`SELECT scope, purpose, policy_version AS "policyVersion", granted_at AS "grantedAt", revoked_at AS "revokedAt" FROM governance.consents WHERE grantor_id=$1 ORDER BY granted_at`),
      videoChecks: await q(`SELECT ch.id AS "challengeId", p.name AS "property", ch.consent_at AS "consentGivenAt", ch.issued_at AS "issuedAt", ch.takes AS "recordings", ch.used_at AS "submittedAt",
                                   e.start_lat AS "startLatitude", e.start_lon AS "startLongitude", e.start_accuracy_m AS "startAccuracyMetres", e.start_at AS "startReadingAt",
                                   e.end_lat AS "endLatitude", e.end_lon AS "endLongitude", e.end_accuracy_m AS "endAccuracyMetres", e.end_at AS "endReadingAt", e.hints AS "computedNotes"
                              FROM verification.t2_challenges ch JOIN supply.properties p ON p.id = ch.property_id LEFT JOIN verification.t2_evidence e ON e.challenge_id = ch.id
                             WHERE ch.requested_by=$1 ORDER BY ch.issued_at`),
      reviewWork: await q(`SELECT case_id AS "caseId", claimed_at AS "startedAt", ended_at AS "endedAt", end_reason AS "endedHow", handling_seconds AS "countedSeconds" FROM verification.review_sessions WHERE reviewer_id=$1 ORDER BY claimed_at`),
      activity: await q(`SELECT action, occurred_at AS "at" FROM governance.audit_events WHERE actor_id=$1 ORDER BY occurred_at DESC LIMIT 500`),
      requests: await this.mine(userId),
      policyAcceptances: await q(`SELECT doc, version, lang, accepted_at AS "acceptedAt" FROM governance.policy_acceptances WHERE user_id=$1 ORDER BY accepted_at`),
      notIncluded: [
        'Sign-in codes and session tokens (kept only as one-way scrambled values that cannot be turned back into the original).',
        'Sign-in address checks (kept only as scrambled values and deleted after one day).',
        'The identity of reviewers who decided your cases.',
        'Other people\'s information inside your organisations.',
        'The document, photo and video files themselves. Ask us if you need copies.',
        'Internal quality checks about reviewers. These are under legal review.',
      ],
    };
    await this.audit.record({ actorId: userId, action: 'privacy.export_downloaded', subjectType: 'user', subjectId: userId });   // no contents in the record
    return data;
  }

  /** Which documents are in force, and whether this person has accepted the current version of each. Nothing is listed until a version is set. */
  async policies(userId: string) {
    const items: { doc: Doc; version: string; accepted: boolean; acceptedAt: string | null }[] = [];
    for (const doc of DOCS) {
      const version = currentVersion(doc); if (!version) continue;
      const a = (await this.pool.query(`SELECT accepted_at FROM governance.policy_acceptances WHERE user_id=$1 AND doc=$2 AND version=$3`, [userId, doc, version])).rows[0];
      items.push({ doc, version, accepted: !!a, acceptedAt: a ? new Date(a.accepted_at).toISOString() : null });
    }
    return { required: items.some((i) => !i.accepted), items };
  }

  /** Record acceptance of the current version. Accepting twice changes nothing. An old or unknown version is refused, so the record can never claim text that was not in force. */
  async accept(userId: string, body: any) {
    const doc = body?.doc as Doc, version = String(body?.version ?? ''), lang = body?.lang;
    if (!DOCS.includes(doc)) throw new BadRequestException('Choose the privacy notice or the terms');
    if (!['en', 'sw'].includes(lang)) throw new BadRequestException('Language must be en or sw');
    const cur = currentVersion(doc);
    if (!cur) throw new ConflictException('This document is not in force yet');
    if (version !== cur) throw new ConflictException('This is not the current version. Reload the page and read it again.');
    const r = await this.pool.query(`INSERT INTO governance.policy_acceptances (user_id, doc, version, lang) VALUES ($1,$2,$3,$4) ON CONFLICT (user_id, doc, version) DO NOTHING RETURNING id`, [userId, doc, version, lang]);
    if (r.rowCount) await this.audit.record({ actorId: userId, action: 'policy.accepted', subjectType: 'user', subjectId: userId, metadata: { doc, version } });
    return this.policies(userId);
  }

  async mine(userId: string) {
    return (await this.pool.query(
      `SELECT id, kind, details, status, created_at AS "createdAt", handled_at AS "handledAt", resolution_note AS "resolutionNote"
         FROM governance.data_requests WHERE user_id=$1 ORDER BY created_at DESC`, [userId])).rows;
  }

  async file(userId: string, body: { kind?: unknown; details?: unknown }) {
    if (typeof body?.kind !== 'string' || !KINDS.includes(body.kind)) throw new BadRequestException('kind must be correction or deletion');
    const details = typeof body.details === 'string' ? body.details.trim() : '';
    if (details.length > 1000) throw new BadRequestException('Keep the details to 1000 characters.');
    if (body.kind === 'correction' && details.length < 5) throw new BadRequestException('Say what is wrong and what it should be (at least 5 characters).');
    try {
      const r = (await this.pool.query(`INSERT INTO governance.data_requests (user_id, kind, details) VALUES ($1,$2,$3) RETURNING id, kind, status, created_at AS "createdAt"`, [userId, body.kind, details])).rows[0];
      await this.audit.record({ actorId: userId, action: 'privacy.request_filed', subjectType: 'data_request', subjectId: r.id, metadata: { kind: body.kind } });
      return r;
    } catch (e: any) {
      if (e?.code === '23505') throw new ConflictException({ code: 'request_already_open', message: 'You already have an open request of this kind. We will answer it.' });
      throw e;
    }
  }

  // ---------- administrator ----------
  private async logView(adminId: string, resource: string, reason: string) {
    await this.pool.query(`INSERT INTO governance.data_access_log (accessor_id, resource, reason) VALUES ($1,$2,$3)`, [adminId, resource, reason]);
  }

  /** The requester's name and number are shown so the administrator can confirm who is asking before acting. Every view is logged. */
  async list(adminId: string, status?: string) {
    if (status !== undefined && !['open', 'completed', 'declined'].includes(status)) throw new BadRequestException('status must be open, completed or declined');
    const rows = (await this.pool.query(
      `SELECT r.id, r.kind, r.details, r.status, r.created_at AS "createdAt", r.handled_at AS "handledAt", r.resolution_note AS "resolutionNote",
              u.full_name AS "fullName", u.phone, (r.status = 'open' AND r.user_id = $2) AS "isYours"
         FROM governance.data_requests r JOIN identity.users u ON u.id = r.user_id
        WHERE ($1::text IS NULL OR r.status = $1) ORDER BY (r.status = 'open') DESC, r.created_at`, [status ?? null, adminId])).rows;
    await this.logView(adminId, 'admin_privacy_requests', `listed ${rows.length}${status ? ' ' + status : ''}`);
    return { requests: rows };
  }

  async handle(requestId: string, adminId: string, body: { status?: unknown; note?: unknown }) {
    if (!['completed', 'declined'].includes(body?.status as string)) throw new BadRequestException('status must be completed or declined');
    const note = typeof body?.note === 'string' ? body.note.trim() : '';
    if (note.length < 5 || note.length > 1000) throw new BadRequestException('Give a note of 5 to 1000 characters saying what was done or why not.');
    try {
      const r = await this.pool.query(`UPDATE governance.data_requests SET status=$2, handled_by=$3, handled_at=now(), resolution_note=$4 WHERE id=$1 RETURNING id, kind, status, user_id`, [requestId, body.status, adminId, note]);
      if (!r.rowCount) throw new NotFoundException('Request not found');
      const row = r.rows[0];
      await this.audit.record({ actorId: adminId, action: 'privacy.request_handled', subjectType: 'data_request', subjectId: row.id, metadata: { kind: row.kind, outcome: row.status } });
      return { id: row.id, status: row.status };
    } catch (e: any) {
      if (e instanceof NotFoundException) throw e;
      if (/closed request|about themselves|only an administrator|only be closed/.test(String(e?.message))) throw new ConflictException({ code: 'request_not_allowed', message: 'This request cannot be handled that way.' });
      throw e;
    }
  }
}
