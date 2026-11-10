import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { bootApp } from '../../test-utils/http';

process.env.STORAGE_DRIVER = 'fake';
const t = process.env.DATABASE_URL ? test : test.skip;

// Each run uses its own bytes and positions, so earlier runs against the same database cannot trigger the reuse hints.
const RUN = Array.from({ length: 8 }, () => Math.floor(Math.random() * 256));
const mp4 = (seed: number) => Uint8Array.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32, ...RUN, ...new Array(380).fill(seed)]);
const PIN = { lat: -1 - Math.random() * 0.8, lon: 36 + Math.random() * 0.9 };
const YES = { code_heard: true, place_matches_address: true, units_shown: true, footage_continuous: true, location_close: true, matches_documents: true };

t('T2 review over HTTP: queue marker, evidence panel, logged video link, checklist, decisions, appeal by someone else, isolation', async (ctx) => {
  process.env.T2_ENABLED = 'true';
  const h = await bootApp();
  try {
    const { STORAGE_PORT } = await import('../supply/files/storage.port');
    const fake: any = h.app.get(STORAGE_PORT);
    const mgr = await h.login(), insider = await h.login(), r1 = await h.login(), r2 = await h.login(), r3 = await h.login();
    const mgrId = await h.userId(mgr.p), r1Id = await h.userId(r1.p), r2Id = await h.userId(r2.p), r3Id = await h.userId(r3.p), insiderId = await h.userId(insider.p);
    const org = (await h.call('POST', '/orgs', { name: 'Review Videos', kind: 'agency' }, mgr.accessToken)).body;
    for (const id of [r1Id, r2Id, r3Id, insiderId]) await h.pool.query(`INSERT INTO identity.platform_roles (user_id, role) VALUES ($1,'reviewer')`, [id]);
    await h.pool.query(`INSERT INTO identity.memberships (user_id, org_id, role) VALUES ($1,$2,'manager_staff')`, [insiderId, org.id]);
    await h.pool.query(`INSERT INTO verification.badges (subject_type, subject_id, level, expires_at) VALUES ('user',$1,'id_verified', now() + interval '1 year')`, [mgrId]);

    let n = 0;
    /** A property with a valid T1 (and one document), then a real T2 submission through the manager API. Returns the case id. */
    const submitted = async (label: string, offset = { lat: 0.0002, lon: 0 }) => {
      n++;
      const pin = { lat: PIN.lat - n * 0.03, lon: PIN.lon + n * 0.03 };
      const p = (await h.call('POST', `/orgs/${org.id}/properties`, { name: label, addressText: `${label} Road`, latitude: pin.lat, longitude: pin.lon }, mgr.accessToken)).body;
      await h.call('POST', `/orgs/${org.id}/properties/${p.id}/units`, { label: 'U1', bedrooms: 1 }, mgr.accessToken);
      const doc = (await h.pool.query(
        `INSERT INTO supply.files (id, org_id, property_id, kind, doc_type, storage_path, original_name, mime_type, size_bytes, uploaded_by, status) VALUES ($5,$1,$2,'document','title_deed',$3,'deed.pdf','application/pdf',100,$4,'ready') RETURNING id`,
        [org.id, p.id, `docs/${p.id}/deed.pdf`, mgrId, randomUUID()])).rows[0].id;
      fake.put(`docs/${p.id}/deed.pdf`, Uint8Array.from([37, 80, 68, 70]));
      await h.pool.query(`INSERT INTO verification.badges (subject_type, subject_id, level, expires_at) VALUES ('property',$1,'t1_documented', now() + interval '1 year')`, [p.id]);
      const T = `/orgs/${org.id}/properties/${p.id}/verification/t2`;
      const ch = (await h.call('POST', `${T}/challenge`, { consent: true }, mgr.accessToken)).body;
      const bytes = mp4(n);
      const tk = (await h.call('POST', `${T}/challenge/${ch.id}/take`, { mimeType: 'video/mp4', sizeBytes: bytes.length }, mgr.accessToken)).body;
      fake.put((await h.pool.query('SELECT storage_path FROM supply.files WHERE id=$1', [tk.fileId])).rows[0].storage_path, bytes);
      await h.call('POST', `/orgs/${org.id}/properties/${p.id}/files/${tk.fileId}/complete`, undefined, mgr.accessToken);
      const iso = (s: number) => new Date(Date.now() + s * 1000).toISOString();
      const sub = await h.call('POST', `${T}/submit`, {
        challengeId: ch.id, fileId: tk.fileId,
        start: { lat: pin.lat + offset.lat, lon: pin.lon + offset.lon, accuracyM: 12, at: iso(0) }, end: { lat: pin.lat + offset.lat + 0.0001, lon: pin.lon + offset.lon, accuracyM: 12, at: iso(45) },
      }, mgr.accessToken);
      assert.equal(sub.status, 201, JSON.stringify(sub.body));
      return { caseId: sub.body.caseId as string, propertyId: p.id as string, T, doc: doc as string, videoId: tk.fileId as string, code: ch.code as string, pin };
    };
    const claim = (id: string, r = r1) => h.call('POST', `/review/cases/${id}/claim`, undefined, r.accessToken);
    const decide = (id: string, body: any, r = r1) => h.call('POST', `/review/cases/${id}/decision`, body, r.accessToken);
    const logCount = async (resource: string, like: string) => (await h.pool.query(`SELECT count(*)::int n FROM governance.data_access_log WHERE resource=$1 AND reason LIKE $2`, [resource, like])).rows[0].n;

    const a = await submitted('Alpha Court');

    await ctx.test('the T2 case is in the queue marked T2; the organisation insider cannot see or claim it; others can', async () => {
      const q = (await h.call('GET', '/review/cases/queue', undefined, r1.accessToken)).body as any[];
      const row = q.find((c) => c.id === a.caseId); assert.ok(row); assert.equal(row.tier, 't2'); assert.ok(row.riskFlags.includes('t2'));
      assert.ok(!(await h.call('GET', '/review/cases/queue', undefined, insider.accessToken)).body.some((c: any) => c.id === a.caseId));
      assert.equal((await claim(a.caseId, insider)).status, 404);
      assert.equal((await h.call('GET', '/review/cases/queue', undefined, mgr.accessToken)).status, 403);
      assert.equal((await claim(a.caseId)).status, 200);
    });

    await ctx.test('the evidence panel shows challenge, window, readings against the pin, advisory hints and the video; opening is logged', async () => {
      const d = (await h.call('GET', `/review/cases/${a.caseId}`, undefined, r1.accessToken)).body;
      assert.equal(d.tier, 't2'); assert.ok(d.t2); assert.equal(d.t2.attempt, 1);
      assert.equal(d.t2.challenge.code, a.code); assert.deepEqual(d.t2.challenge.units, ['U1']);
      assert.equal(d.t2.window.startedInside, true); assert.equal(d.t2.window.endedInside, true);
      assert.ok(Math.abs(d.t2.pin.lat - a.pin.lat) < 1e-5);
      assert.ok(d.t2.start.distanceM > 15 && d.t2.start.distanceM < 30, `about 22 m: ${d.t2.start.distanceM}`); assert.equal(d.t2.start.band, 'near'); assert.equal(d.t2.start.accuracyM, 12);
      assert.deepEqual(d.t2.hints.flags, []); assert.equal(d.t2.video.available, true); assert.equal(d.t2.videoOpened, false); assert.equal(d.allOpened, false);
      assert.equal(d.files.length, 1); assert.equal(d.files[0].id, a.doc);
      assert.ok(!JSON.stringify(d).includes('video_sha256') && !JSON.stringify(d).includes('storage_path'), 'no fingerprint or storage path leaves the server');
      assert.ok((await logCount('t2_evidence', `case ${a.caseId}`)) >= 1, 'viewing the readings is logged');
    });

    await ctx.test('approval is refused until the video and every document have been opened; the video link is logged and short-lived', async () => {
      const early = await decide(a.caseId, { decision: 'approve', checklist: YES });
      assert.equal(early.status, 422); assert.equal(early.body.code, 'video_not_opened');
      const v = await h.call('POST', `/review/cases/${a.caseId}/video/link`, undefined, r1.accessToken);
      assert.equal(v.status, 200); assert.equal(v.body.expiresInSec, 300); assert.ok(typeof v.body.url === 'string' && v.body.url.length > 10);
      assert.equal(await logCount('file:video', `case ${a.caseId} file ${a.videoId}`), 1);
      assert.equal((await h.pool.query(`SELECT count(*)::int n FROM governance.audit_events WHERE action='verification.video_opened' AND subject_id=$1`, [a.caseId])).rows[0].n, 1);
      assert.ok(!/code|lat|lon/i.test(JSON.stringify((await h.pool.query(`SELECT metadata FROM governance.audit_events WHERE action='verification.video_opened' AND subject_id=$1`, [a.caseId])).rows[0].metadata)));
      const docsFirst = await decide(a.caseId, { decision: 'approve', checklist: YES });
      assert.equal(docsFirst.status, 422); assert.equal(docsFirst.body.code, 'documents_not_opened');
      assert.equal((await h.call('POST', `/review/cases/${a.caseId}/files/${a.doc}/link`, undefined, r1.accessToken)).status, 200);
      const d = (await h.call('GET', `/review/cases/${a.caseId}`, undefined, r1.accessToken)).body;
      assert.equal(d.t2.videoOpened, true); assert.equal(d.allOpened, true);
    });

    await ctx.test('the video link works only for the reviewer holding a T2 case; a stranger and the manager get nothing', async () => {
      assert.equal((await h.call('POST', `/review/cases/${a.caseId}/video/link`, undefined, r2.accessToken)).status, 404);
      assert.equal((await h.call('POST', `/review/cases/${a.caseId}/video/link`, undefined, mgr.accessToken)).status, 403);
      assert.equal((await h.call('POST', `/review/cases/${a.caseId}/video/link`)).status, 401);
      assert.equal((await h.call('GET', `/review/cases/${a.caseId}`, undefined, r2.accessToken)).status, 404);
    });

    await ctx.test('the checklist is mandatory and only six yeses can approve; a failed request changes nothing', async () => {
      for (const body of [{ decision: 'approve' }, { decision: 'approve', checklist: { ...YES, location_close: false } }, { decision: 'approve', checklist: { code_heard: true } }, { decision: 'approve', checklist: { ...YES, units_shown: 'yes' } }]) {
        assert.equal((await decide(a.caseId, body)).status, 400, JSON.stringify(body));
      }
      assert.equal((await h.pool.query('SELECT status FROM verification.cases WHERE id=$1', [a.caseId])).rows[0].status, 'in_review');
      assert.equal((await decide(a.caseId, { decision: 'reject', checklist: YES })).status, 400, 'a rejection needs a reason');
      assert.equal((await decide(a.caseId, { decision: 'reject', checklist: YES, reasonCode: 'doc_expired' })).status, 400, 'document-only reasons do not apply to a video');
    });

    await ctx.test('approve gives a six-month video badge, saves the checklist and records it in the audit trail', async () => {
      const r = await decide(a.caseId, { decision: 'approve', checklist: YES });
      assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.status, 'approved'); assert.ok(r.body.badgeId);
      const b = (await h.pool.query('SELECT level, issued_at, expires_at, verified_by, evidence_ref FROM verification.badges WHERE id=$1', [r.body.badgeId])).rows[0];
      assert.equal(b.level, 't2_video'); assert.equal(b.verified_by, r1Id); assert.equal(b.evidence_ref, `case:${a.caseId}`);
      const days = (new Date(b.expires_at).getTime() - new Date(b.issued_at).getTime()) / 86400e3; assert.ok(days > 178 && days <= 186, String(days));
      const c = (await h.pool.query('SELECT t2_checklist, decided_by FROM verification.cases WHERE id=$1', [a.caseId])).rows[0];
      assert.deepEqual(c.t2_checklist, YES); assert.equal(c.decided_by, r1Id);
      const ev = (await h.pool.query(`SELECT metadata FROM governance.audit_events WHERE action='verification.approved' AND subject_id=$1`, [a.caseId])).rows[0].metadata;
      assert.equal(ev.tier, 't2'); assert.deepEqual(ev.checklist, YES); assert.deepEqual(Object.keys(ev).sort(), ['badgeId', 'checklist', 'flagged', 'orgId', 'propertyId', 'reasonCode', 'tier'], 'no code, no coordinates');
      assert.equal((await decide(a.caseId, { decision: 'reject', checklist: YES, reasonCode: 'other', note: 'x' })).status, 409, 'a decision is final');
      const s = (await h.call('GET', a.T, undefined, mgr.accessToken)).body;
      assert.equal(s.badge !== null && s.badge !== undefined, true); assert.ok(!JSON.stringify(s).includes(r1Id), 'the manager never learns who decided');
      const hist = (await h.call('GET', '/review/cases/history', undefined, r1.accessToken)).body as any[];
      assert.ok(hist.some((x) => x.id === a.caseId && x.kind === 'approved' && x.tier === 't2'));
    });

    const b = await submitted('Bravo Court', { lat: 0.2, lon: 0 });   // about 22 km from the pin
    await ctx.test('far-away readings show in the hints and the queue, yet nothing is decided for the reviewer', async () => {
      const q = (await h.call('GET', '/review/cases/queue', undefined, r1.accessToken)).body as any[];
      assert.ok(q.find((c) => c.id === b.caseId).riskFlags.includes('location_very_far'));
      assert.equal((await claim(b.caseId)).status, 200);
      const d = (await h.call('GET', `/review/cases/${b.caseId}`, undefined, r1.accessToken)).body;
      assert.ok(d.t2.hints.flags.includes('location_very_far')); assert.equal(d.t2.start.band, 'very_far'); assert.ok(d.t2.start.distanceM > 20000);
      assert.equal((await h.pool.query('SELECT status FROM verification.cases WHERE id=$1', [b.caseId])).rows[0].status, 'in_review');
    });

    await ctx.test('needs changes pauses the case with a T2 reason; the manager then records again and the new recording must be watched', async () => {
      const r = await decide(b.caseId, { decision: 'needs_changes', checklist: { ...YES, location_close: false }, reasonCode: 't2_location_mismatch', note: 'Record at the gate' });
      assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.status, 'needs_changes');
      const row = (await h.pool.query('SELECT status, claimed_by, decided_by, reason_code FROM verification.cases WHERE id=$1', [b.caseId])).rows[0];
      assert.equal(row.status, 'needs_changes'); assert.equal(row.claimed_by, null); assert.equal(row.decided_by, null); assert.equal(row.reason_code, 't2_location_mismatch');
      const ev = (await h.pool.query(`SELECT metadata FROM governance.audit_events WHERE action='verification.needs_changes' AND subject_id=$1`, [b.caseId])).rows[0].metadata;
      assert.equal(ev.checklist.location_close, false, 'the answers survive the next round in the audit trail');
      // manager records again, near the pin this time
      const ch = (await h.call('POST', `${b.T}/challenge`, { consent: true }, mgr.accessToken)).body, bytes = mp4(99);
      const tk = (await h.call('POST', `${b.T}/challenge/${ch.id}/take`, { mimeType: 'video/mp4', sizeBytes: bytes.length }, mgr.accessToken)).body;
      fake.put((await h.pool.query('SELECT storage_path FROM supply.files WHERE id=$1', [tk.fileId])).rows[0].storage_path, bytes);
      await h.call('POST', `/orgs/${org.id}/properties/${b.propertyId}/files/${tk.fileId}/complete`, undefined, mgr.accessToken);
      const iso = (s: number) => new Date(Date.now() + s * 1000).toISOString();
      const sub = await h.call('POST', `${b.T}/submit`, { challengeId: ch.id, fileId: tk.fileId, start: { lat: b.pin.lat + 0.0002, lon: b.pin.lon, accuracyM: 10, at: iso(0) }, end: { lat: b.pin.lat + 0.0003, lon: b.pin.lon, accuracyM: 10, at: iso(40) } }, mgr.accessToken);
      assert.equal(sub.status, 201, JSON.stringify(sub.body)); assert.equal(sub.body.attempt, 2);
      assert.equal((await claim(b.caseId, r2)).status, 200, 'another reviewer may take the second round');
      const d = (await h.call('GET', `/review/cases/${b.caseId}`, undefined, r2.accessToken)).body;
      assert.equal(d.t2.attempt, 2); assert.equal(d.t2.attempts.length, 2); assert.equal(d.t2.videoOpened, false, 'watching the first recording does not count');
      const early = await decide(b.caseId, { decision: 'approve', checklist: YES }, r2); assert.equal(early.status, 422); assert.equal(early.body.code, 'video_not_opened');
      assert.equal(await logCount('file:video', `case ${b.caseId} file ${b.videoId}`), 0, 'the first recording was never opened, and cannot be now');
      assert.equal((await h.call('POST', `/review/cases/${b.caseId}/video/link`, undefined, r2.accessToken)).status, 200);
      assert.equal(await logCount('file:video', `case ${b.caseId} file ${tk.fileId}`), 1, 'the link is for the latest recording');
    });

    const c = await submitted('Charlie Court');
    await ctx.test('reject needs a reason; the manager sees it and may appeal; the appeal reads the same recording and goes to a different reviewer', async () => {
      assert.equal((await claim(c.caseId)).status, 200);
      const r = await decide(c.caseId, { decision: 'reject', checklist: { ...YES, footage_continuous: false }, reasonCode: 't2_suspected_replay', note: 'Looks like a screen' });
      assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.status, 'rejected');
      const s = (await h.call('GET', c.T, undefined, mgr.accessToken)).body; assert.equal(s.case.reasonCode, 't2_suspected_replay'); assert.equal(s.case.canAppeal, true);
      const ap = await h.call('POST', `${c.T}/appeal`, undefined, mgr.accessToken); assert.equal(ap.status, 201, JSON.stringify(ap.body));
      const q1 = (await h.call('GET', '/review/cases/queue', undefined, r1.accessToken)).body as any[];
      assert.ok(!q1.some((x) => x.id === ap.body.caseId), 'the original reviewer never sees the appeal');
      assert.equal((await claim(ap.body.caseId, r1)).status, 404);
      assert.equal((await claim(ap.body.caseId, r3)).status, 200);
      const d = (await h.call('GET', `/review/cases/${ap.body.caseId}`, undefined, r3.accessToken)).body;
      assert.equal(d.isAppeal, true); assert.equal(d.earlierDecision.reasonCode, 't2_suspected_replay'); assert.equal(d.t2.challenge.code, c.code, 'same recording as the original');
      const v = await h.call('POST', `/review/cases/${ap.body.caseId}/video/link`, undefined, r3.accessToken); assert.equal(v.status, 200);
      assert.equal(await logCount('file:video', `case ${ap.body.caseId} file ${c.videoId}`), 1);
      assert.equal((await h.call('POST', `/review/cases/${ap.body.caseId}/files/${c.doc}/link`, undefined, r3.accessToken)).status, 200);
      const ok = await decide(ap.body.caseId, { decision: 'approve', checklist: YES }, r3);
      assert.equal(ok.status, 200, JSON.stringify(ok.body)); assert.equal((await h.pool.query('SELECT level FROM verification.badges WHERE id=$1', [ok.body.badgeId])).rows[0].level, 't2_video');
    });

    const d3 = await submitted('Delta Court');
    await ctx.test('if the T1 badge lapses before the decision a video badge cannot be given, but the case can still be closed', async () => {
      assert.equal((await claim(d3.caseId)).status, 200);
      await h.call('POST', `/review/cases/${d3.caseId}/video/link`, undefined, r1.accessToken); await h.call('POST', `/review/cases/${d3.caseId}/files/${d3.doc}/link`, undefined, r1.accessToken);
      await h.pool.query(`UPDATE verification.badges SET revoked_at = now(), revoke_reason_code='other', revoke_note='test' WHERE subject_id=$1 AND level='t1_documented'`, [d3.propertyId]);
      const r = await decide(d3.caseId, { decision: 'approve', checklist: YES });
      assert.equal(r.status, 409); assert.equal(r.body.code, 't1_not_valid');
      assert.equal((await h.pool.query(`SELECT count(*)::int n FROM verification.badges WHERE subject_id=$1 AND level='t2_video'`, [d3.propertyId])).rows[0].n, 0, 'no badge is left behind by the refused approval');
      assert.equal((await decide(d3.caseId, { decision: 'needs_changes', checklist: YES, reasonCode: 'other', note: 'Renew the documents first' })).status, 200);
    });

    await ctx.test('a T1 case is unaffected: T2 reasons and checklists do not apply, and the video link answers 404', async () => {
      const p = (await h.call('POST', `/orgs/${org.id}/properties`, { name: 'Echo T1', addressText: 'Echo Rd' }, mgr.accessToken)).body;
      const f = (await h.pool.query(`INSERT INTO supply.files (id, org_id, property_id, kind, doc_type, storage_path, original_name, mime_type, size_bytes, uploaded_by, status) VALUES ($4,$1,$2,'document','title_deed',$5,'y.pdf','application/pdf',10,$3,'ready') RETURNING id`, [org.id, p.id, mgrId, randomUUID(), `x/${randomUUID()}.pdf`])).rows[0].id;
      const c1 = (await h.pool.query(`INSERT INTO verification.cases (org_id, property_id, status, submitted_by, due_at) VALUES ($1,$2,'submitted',$3, now() + interval '2 days') RETURNING id`, [org.id, p.id, mgrId])).rows[0].id;
      await h.pool.query(`INSERT INTO verification.case_files (case_id, file_id) VALUES ($1,$2)`, [c1, f]);
      assert.equal((await claim(c1)).status, 200);
      assert.equal((await h.call('POST', `/review/cases/${c1}/video/link`, undefined, r1.accessToken)).status, 404);
      assert.equal((await decide(c1, { decision: 'reject', reasonCode: 't2_code_missing' })).status, 400, 'a T2 reason on a T1 case');
      assert.equal((await decide(c1, { decision: 'reject', reasonCode: 'doc_expired' })).status, 200);
      const d = (await h.call('GET', `/review/cases/${c1}`, undefined, r1.accessToken)).body; assert.equal(d.tier, 't1'); assert.equal(d.t2, undefined);
    });
  } finally { delete process.env.T2_ENABLED; await h.close(); }
});
