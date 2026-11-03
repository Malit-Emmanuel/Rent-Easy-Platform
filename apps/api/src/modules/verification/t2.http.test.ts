import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'crypto';
import { bootApp } from '../../test-utils/http';

process.env.STORAGE_DRIVER = 'fake';
const t = process.env.DATABASE_URL ? test : test.skip;

// Each run uses its own bytes and positions, so earlier runs against the same database cannot trigger the reuse hints.
const RUN = Array.from({ length: 8 }, () => Math.floor(Math.random() * 256));
const mp4 = (seed: number, n = 400) => Uint8Array.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32, ...RUN, ...new Array(n - 20).fill(seed)]);
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const PIN = { lat: -1 - Math.random() * 0.8, lon: 36 + Math.random() * 0.9 };

t('T2 challenge and submission over HTTP: switch, challenge, takes, readings, hints, resubmission, appeal, isolation', async (ctx) => {
  delete process.env.T2_ENABLED;
  const h = await bootApp();
  try {
    const { STORAGE_PORT } = await import('../supply/files/storage.port');
    const fake: any = h.app.get(STORAGE_PORT);
    const admin = await h.login(), staff = await h.login(), outsider = await h.login(), reviewer = await h.login();
    const adminId = await h.userId(admin.p), staffId = await h.userId(staff.p), reviewerId = await h.userId(reviewer.p);
    const org = (await h.call('POST', '/orgs', { name: 'Video Managers', kind: 'agency' }, admin.accessToken)).body;
    await h.call('POST', '/orgs', { name: 'Other Agents', kind: 'agency' }, outsider.accessToken);
    await h.pool.query(`INSERT INTO identity.memberships (user_id, org_id, role) VALUES ($1,$2,'manager_staff')`, [staffId, org.id]);
    await h.pool.query(`INSERT INTO identity.platform_roles (user_id, role) VALUES ($1,'reviewer')`, [reviewerId]);
    const prop = (await h.call('POST', `/orgs/${org.id}/properties`, { name: 'Palm Court', addressText: 'Argwings Kodhek Rd', latitude: PIN.lat, longitude: PIN.lon }, admin.accessToken)).body;
    const noPos = (await h.call('POST', `/orgs/${org.id}/properties`, { name: 'No Pin', addressText: 'Somewhere' }, admin.accessToken)).body;
    for (const l of ['A1', 'A2']) await h.call('POST', `/orgs/${org.id}/properties/${prop.id}/units`, { label: l, bedrooms: 1 }, admin.accessToken);
    const T = `/orgs/${org.id}/properties/${prop.id}/verification/t2`;
    const F = `/orgs/${org.id}/properties/${prop.id}/files`;
    const status = async (token = admin.accessToken) => (await h.call('GET', T, undefined, token)).body;
    const addT1 = (pid = prop.id) => h.pool.query(`INSERT INTO verification.badges (subject_type, subject_id, level, expires_at) VALUES ('property',$1,'t1_documented', now() + interval '1 year')`, [pid]);
    const iso = (offsetSec: number) => new Date(Date.now() + offsetSec * 1000).toISOString();
    const readings = (lat = PIN.lat + 0.0002, lon = PIN.lon, acc = 12) => ({ start: { lat, lon, accuracyM: acc, at: iso(0) }, end: { lat: lat + 0.0001, lon, accuracyM: acc, at: iso(45) } });
    /** Start a take, upload bytes to the fake storage and complete it, like the browser will. */
    const record = async (challengeId: string, bytes: Uint8Array, token = admin.accessToken) => {
      const tk = await h.call('POST', `${T}/challenge/${challengeId}/take`, { mimeType: 'video/mp4', sizeBytes: bytes.length }, token);
      if (tk.status !== 201) return { tk };
      const path = (await h.pool.query('SELECT storage_path FROM supply.files WHERE id=$1', [tk.body.fileId])).rows[0].storage_path;
      fake.put(path, bytes);
      const done = await h.call('POST', `${F}/${tk.body.fileId}/complete`, undefined, token);
      return { tk, done, path };
    };
    let ch: any, firstCase = '', takeA: any;

    await ctx.test('switched off by default: status says so and no challenge can be issued', async () => {
      const s = await status(); assert.equal(s.enabled, false); assert.ok(s.blockers.includes('t2_disabled')); assert.equal(s.eligible, false);
      const r = await h.call('POST', `${T}/challenge`, { consent: true }, admin.accessToken);
      assert.equal(r.status, 403); assert.equal(r.body.code, 't2_disabled');
      process.env.T2_ENABLED = 'true';
    });

    await ctx.test('blockers are listed: ID not verified, no valid T1, then the clean state', async () => {
      let s = await status(); assert.ok(s.blockers.includes('id_not_verified')); assert.ok(s.blockers.includes('no_valid_t1')); assert.equal(s.eligible, false);
      assert.equal((await h.call('POST', `${T}/challenge`, { consent: true }, admin.accessToken)).status, 403);
      await h.pool.query(`INSERT INTO verification.badges (subject_type, subject_id, level, expires_at) VALUES ('user',$1,'id_verified', now() + interval '1 year')`, [adminId]);
      await h.pool.query(`INSERT INTO verification.badges (subject_type, subject_id, level, expires_at) VALUES ('user',$1,'id_verified', now() + interval '1 year')`, [staffId]);
      const r = await h.call('POST', `${T}/challenge`, { consent: true }, admin.accessToken);
      assert.equal(r.status, 422); assert.equal(r.body.code, 'no_valid_t1');
      await addT1();
      s = await status(); assert.deepEqual(s.blockers, []); assert.equal(s.eligible, true);
    });

    await ctx.test('a property with no recorded position cannot start; units are needed too', async () => {
      await addT1(noPos.id);
      const r = await h.call('POST', `/orgs/${org.id}/properties/${noPos.id}/verification/t2/challenge`, { consent: true }, admin.accessToken);
      assert.equal(r.status, 422); assert.equal(r.body.code, 'no_position');
    });

    await ctx.test('consent must be an explicit yes', async () => {
      for (const b of [undefined, {}, { consent: 'yes' }, { consent: false }]) assert.equal((await h.call('POST', `${T}/challenge`, b as any, admin.accessToken)).status, 400);
      assert.equal((await h.pool.query('SELECT count(*)::int n FROM verification.t2_challenges WHERE property_id=$1', [prop.id])).rows[0].n, 0);
    });

    await ctx.test('a challenge gives a four-digit code, one unit of this property, a 30-minute window, and is audited without the code', async () => {
      const r = await h.call('POST', `${T}/challenge`, { consent: true }, admin.accessToken);
      assert.equal(r.status, 201); ch = r.body;
      assert.match(ch.code, /^\d{4}$/); assert.equal(ch.unitsToShow.length, 1); assert.ok(['A1', 'A2'].includes(ch.unitsToShow[0].label));
      const mins = (new Date(ch.expiresAt).getTime() - new Date(ch.issuedAt).getTime()) / 60000; assert.ok(mins > 29.9 && mins <= 30.01);
      assert.equal(ch.takesLeft, 3); assert.ok(Math.abs(new Date(ch.now).getTime() - Date.now()) < 5000, 'the server time is sent so a phone with a wrong clock can correct for it');
      const ev = (await h.pool.query(`SELECT metadata FROM governance.audit_events WHERE action='verification.t2_challenge_issued' AND subject_id=$1`, [ch.id])).rows;
      assert.equal(ev.length, 1); assert.deepEqual(Object.keys(ev[0].metadata).sort(), ['orgId', 'propertyId', 'units'], 'the code is not written to the audit trail');
      const row = (await h.pool.query('SELECT consent_at FROM verification.t2_challenges WHERE id=$1', [ch.id])).rows[0]; assert.ok(row.consent_at);
    });

    await ctx.test('only one active challenge per property; a colleague sees it but not the code or units', async () => {
      const again = await h.call('POST', `${T}/challenge`, { consent: true }, staff.accessToken);
      assert.equal(again.status, 409); assert.equal(again.body.code, 'challenge_active');
      const mine = await status(); assert.equal(mine.challenge.id, ch.id); assert.equal(mine.challenge.code, ch.code); assert.equal(mine.challenge.mine, true); assert.equal(mine.eligible, false);
      const theirs = await status(staff.accessToken);
      assert.equal(theirs.challenge.mine, false); assert.equal(theirs.challenge.code, undefined); assert.equal(theirs.challenge.unitsToShow, undefined);
      const take = await h.call('POST', `${T}/challenge/${ch.id}/take`, { mimeType: 'video/mp4', sizeBytes: 400 }, staff.accessToken);
      assert.equal(take.status, 404, 'only the person who received the challenge can record for it');
    });

    await ctx.test('isolation: outsiders, other organisations and signed-out callers get nothing', async () => {
      assert.equal((await h.call('GET', T, undefined, outsider.accessToken)).status, 403);
      assert.equal((await h.call('POST', `${T}/challenge`, { consent: true }, outsider.accessToken)).status, 403);
      assert.equal((await h.call('POST', `${T}/submit`, {}, outsider.accessToken)).status, 403);
      assert.equal((await h.call('GET', T)).status, 401);
      const otherOrg = (await h.pool.query(`SELECT o.id FROM identity.organizations o JOIN identity.memberships m ON m.org_id=o.id WHERE m.user_id=$1`, [await h.userId(outsider.p)])).rows[0].id;
      assert.equal((await h.call('GET', `/orgs/${otherOrg}/properties/${prop.id}/verification/t2`, undefined, outsider.accessToken)).status, 404);
    });

    await ctx.test('a take must be a video of an allowed size; storage trouble costs no take', async () => {
      assert.equal((await h.call('POST', `${T}/challenge/${ch.id}/take`, { mimeType: 'application/pdf', sizeBytes: 400 }, admin.accessToken)).status, 400);
      assert.equal((await h.call('POST', `${T}/challenge/${ch.id}/take`, { mimeType: 'video/mp4', sizeBytes: 46 * 1024 * 1024 }, admin.accessToken)).status, 400);
      const orig = fake.createSignedUpload.bind(fake); fake.createSignedUpload = async () => { throw new Error('down'); };
      try { assert.equal((await h.call('POST', `${T}/challenge/${ch.id}/take`, { mimeType: 'video/mp4', sizeBytes: 400 }, admin.accessToken)).status, 502); } finally { fake.createSignedUpload = orig; }
      assert.equal((await h.pool.query('SELECT takes FROM verification.t2_challenges WHERE id=$1', [ch.id])).rows[0].takes, 0);
      assert.equal((await h.call('POST', `${T}/challenge/00000000-0000-4000-8000-000000000000/take`, { mimeType: 'video/mp4', sizeBytes: 400 }, admin.accessToken)).status, 404);
    });

    await ctx.test('takes: a retake discards the earlier one, a fourth is refused, takes stay out of the ordinary file list', async () => {
      takeA = await record(ch.id, mp4(1));
      assert.equal(takeA.tk.status, 201); assert.equal(takeA.tk.body.take, 1); assert.equal(takeA.tk.body.takesLeft, 2); assert.equal(takeA.done.status, 200);
      const second = await record(ch.id, mp4(2));
      assert.equal(second.tk.body.take, 2);
      assert.equal((await h.pool.query('SELECT status FROM supply.files WHERE id=$1', [takeA.tk.body.fileId])).rows[0].status, 'deleted');
      assert.equal(fake.objects.has(takeA.path), false, 'the discarded video is removed from storage');
      takeA = second;
      const list = (await h.call('GET', F, undefined, admin.accessToken)).body; assert.ok(!list.some((f: any) => f.kind === 'video'), 'T2 videos are not ordinary property media');
      const third = await record(ch.id, mp4(3)); assert.equal(third.tk.body.take, 3); assert.equal(third.tk.body.takesLeft, 0);
      const fourth = await h.call('POST', `${T}/challenge/${ch.id}/take`, { mimeType: 'video/mp4', sizeBytes: 400 }, admin.accessToken);
      assert.equal(fourth.status, 409); assert.equal(fourth.body.code, 'takes_used');
      takeA = third;
    });

    await ctx.test('submission checks: unknown recording, unfinished upload, bad readings, outside the window, someone else', async () => {
      const body = { challengeId: ch.id, fileId: takeA.tk.body.fileId, ...readings() };
      assert.equal((await h.call('POST', `${T}/submit`, { ...body, fileId: '00000000-0000-4000-8000-000000000000' }, admin.accessToken)).status, 404);
      assert.equal((await h.call('POST', `${T}/submit`, { ...body, challengeId: 'nope' }, admin.accessToken)).status, 400);
      assert.equal((await h.call('POST', `${T}/submit`, { challengeId: ch.id, fileId: takeA.tk.body.fileId }, admin.accessToken)).status, 400);
      assert.equal((await h.call('POST', `${T}/submit`, { ...body, start: { ...body.start, lat: 51.5 } }, admin.accessToken)).status, 400);
      const early = { start: { ...body.start, at: iso(-3600) }, end: { ...body.end, at: iso(-3555) } };
      const r = await h.call('POST', `${T}/submit`, { ...body, ...early }, admin.accessToken);
      assert.equal(r.status, 422); assert.equal(r.body.code, 'recording_outside_window');
      assert.equal((await h.call('POST', `${T}/submit`, body, staff.accessToken)).status, 404);
      const dead = await h.call('POST', `${T}/submit`, { ...body, fileId: (await h.pool.query(`SELECT file_id FROM verification.t2_takes WHERE challenge_id=$1 AND take_no=1`, [ch.id])).rows[0].file_id }, admin.accessToken);
      assert.equal(dead.status, 409, 'a discarded take cannot be submitted'); assert.equal(dead.body.code, 'upload_not_complete');
      assert.equal((await h.pool.query('SELECT count(*)::int n FROM verification.cases WHERE property_id=$1', [prop.id])).rows[0].n, 0, 'no case from a failed submission');
    });

    await ctx.test('a valid submission creates a T2 case due in three working days, with the fingerprint we computed and hints for the reviewer', async () => {
      const bytes = mp4(3);
      const r = await h.call('POST', `${T}/submit`, { challengeId: ch.id, fileId: takeA.tk.body.fileId, ...readings(), sha256: 'ff'.repeat(32) }, admin.accessToken);
      assert.equal(r.status, 201, JSON.stringify(r.body)); firstCase = r.body.caseId; assert.equal(r.body.status, 'submitted'); assert.equal(r.body.attempt, 1);
      const due = new Date(r.body.dueAt).getTime() - Date.now(); assert.ok(due > 71 * 3600e3 && due < 6 * 86400e3);
      assert.ok(!JSON.stringify(r.body).includes('hint') && !JSON.stringify(r.body).includes('flags'), 'the manager is not shown the hints');
      const c = (await h.pool.query('SELECT tier, status, risk_flags FROM verification.cases WHERE id=$1', [firstCase])).rows[0];
      assert.equal(c.tier, 't2'); assert.equal(c.status, 'submitted'); assert.ok(c.risk_flags.includes('t2'));
      const e = (await h.pool.query('SELECT encode(video_sha256,\'hex\') AS sha, hints, attempt FROM verification.t2_evidence WHERE case_id=$1', [firstCase])).rows[0];
      assert.equal(e.sha, sha(bytes), 'the fingerprint is computed from the stored bytes, not taken from the request');
      assert.deepEqual(e.hints.flags, []); assert.equal(e.hints.startBand, 'near');
      assert.equal((await h.pool.query('SELECT used_at FROM verification.t2_challenges WHERE id=$1', [ch.id])).rows[0].used_at !== null, true);
      const ev = (await h.pool.query(`SELECT metadata FROM governance.audit_events WHERE action='verification.t2_submitted' AND subject_id=$1`, [firstCase])).rows;
      assert.equal(ev.length, 1); assert.ok(!/lat|lon/i.test(JSON.stringify(ev[0].metadata)), 'no coordinates in the audit trail');
    });

    await ctx.test('after submission: the challenge cannot be reused, the pin is frozen, T1 requests are blocked, reviewers cannot see the case yet', async () => {
      const again = await h.call('POST', `${T}/submit`, { challengeId: ch.id, fileId: takeA.tk.body.fileId, ...readings() }, admin.accessToken);
      assert.equal(again.status, 409);
      await assert.rejects(() => h.pool.query(`UPDATE supply.properties SET location = extensions.st_point(36.9, -1.3)::extensions.geography WHERE id=$1`, [prop.id]), /position cannot change while a T2 case is open/);
      const t1 = await h.call('GET', `/orgs/${org.id}/properties/${prop.id}/verification`, undefined, admin.accessToken);
      assert.equal(t1.body.canRequest, false); assert.equal(t1.body.case, null, 'the T1 card never shows a T2 case');
      assert.equal((await h.call('POST', `/orgs/${org.id}/properties/${prop.id}/verification/resubmit`, undefined, admin.accessToken)).status, 409);
      const s = await status(); assert.equal(s.case.status, 'submitted'); assert.equal(s.case.attempts, 1); assert.equal(s.challenge, null); assert.ok(s.blockers.includes('case_open'));
      const q = await h.call('GET', '/review/cases/queue', undefined, reviewer.accessToken);
      assert.equal(q.status, 200); assert.ok(Array.isArray(q.body)); assert.ok(!q.body.some((c: any) => c.id === firstCase), 'T2 cases stay out of the reviewer queue until the evidence panel exists (S5d)');
      assert.equal((await h.call('POST', `/review/cases/${firstCase}/claim`, undefined, reviewer.accessToken)).status, 404);
    });

    await ctx.test('needs changes means a new challenge and a new recording; the same case goes back with a fresh attempt and the hints see a reused video', async () => {
      await h.pool.query(`UPDATE verification.cases SET status='in_review', claimed_by=$2, claimed_at=now() WHERE id=$1`, [firstCase, reviewerId]);
      await h.pool.query(`UPDATE verification.cases SET status='needs_changes', reason_code='t2_code_missing', note='say the code', paused_at=now(), claimed_by=NULL, claimed_at=NULL WHERE id=$1`, [firstCase]);
      let s = await status(); assert.equal(s.case.needsNewRecording, true); assert.equal(s.case.reasonCode, 't2_code_missing'); assert.deepEqual(s.blockers, [], 'a new challenge is allowed');
      const r = await h.call('POST', `${T}/challenge`, { consent: true }, admin.accessToken); assert.equal(r.status, 201);
      const rec = await record(r.body.id, mp4(3));   // the very same bytes as before: a reused video
      const sub = await h.call('POST', `${T}/submit`, { challengeId: r.body.id, fileId: rec.tk.body.fileId, ...readings(PIN.lat + 0.01) }, admin.accessToken);
      assert.equal(sub.status, 201, JSON.stringify(sub.body)); assert.equal(sub.body.caseId, firstCase); assert.equal(sub.body.attempt, 2);
      const row = (await h.pool.query('SELECT status, reason_code, note, paused_at, risk_flags, t2_checklist FROM verification.cases WHERE id=$1', [firstCase])).rows[0];
      assert.equal(row.status, 'submitted'); assert.equal(row.reason_code, null); assert.equal(row.paused_at, null); assert.equal(row.t2_checklist, null);
      assert.ok(row.risk_flags.includes('video_reused') && row.risk_flags.includes('location_very_far'));
      const e = (await h.pool.query('SELECT attempt, hints FROM verification.t2_evidence WHERE case_id=$1 ORDER BY attempt', [firstCase])).rows;
      assert.equal(e.length, 2); assert.ok(e[1].hints.flags.includes('video_reused')); assert.ok(e[1].hints.flags.includes('location_very_far'));
      s = await status(); assert.equal(s.case.attempts, 2);
      assert.equal((await h.pool.query(`SELECT count(*)::int n FROM governance.audit_events WHERE action='verification.t2_resubmitted' AND subject_id=$1`, [firstCase])).rows[0].n, 1);
    });

    await ctx.test('appeal: refused until rejected; then one appeal that reads the original evidence; a second is refused', async () => {
      assert.equal((await h.call('POST', `${T}/appeal`, undefined, admin.accessToken)).status, 409);
      await h.pool.query(`UPDATE verification.cases SET status='in_review', claimed_by=$2, claimed_at=now() WHERE id=$1`, [firstCase, reviewerId]);
      await h.pool.query(`UPDATE verification.cases SET status='rejected', decided_by=$2, decided_at=now(), reason_code='t2_suspected_replay' WHERE id=$1`, [firstCase, reviewerId]);
      let s = await status(); assert.equal(s.case.canAppeal, true); assert.equal(s.case.reasonCode, 't2_suspected_replay');
      const a = await h.call('POST', `${T}/appeal`, undefined, admin.accessToken);
      assert.equal(a.status, 201, JSON.stringify(a.body));
      const row = (await h.pool.query('SELECT tier, appeal_of, risk_flags FROM verification.cases WHERE id=$1', [a.body.caseId])).rows[0];
      assert.equal(row.tier, 't2'); assert.equal(row.appeal_of, firstCase); assert.ok(row.risk_flags.includes('appeal'));
      assert.equal((await h.pool.query('SELECT count(*)::int n FROM verification.t2_evidence WHERE case_id=$1', [a.body.caseId])).rows[0].n, 0, 'no new evidence for an appeal');
      assert.equal((await h.call('POST', `${T}/appeal`, undefined, admin.accessToken)).status, 409);
      s = await status(); assert.equal(s.case.isAppeal, true);
    });

    await ctx.test('a property with more than 10 units gets two different units to show', async () => {
      const big = (await h.call('POST', `/orgs/${org.id}/properties`, { name: 'Big Court', addressText: 'Big Rd', latitude: PIN.lat - 0.05, longitude: PIN.lon + 0.05 }, admin.accessToken)).body;
      for (let i = 1; i <= 11; i++) await h.call('POST', `/orgs/${org.id}/properties/${big.id}/units`, { label: `U${i}`, bedrooms: 1 }, admin.accessToken);
      await addT1(big.id);
      const r = await h.call('POST', `/orgs/${org.id}/properties/${big.id}/verification/t2/challenge`, { consent: true }, admin.accessToken);
      assert.equal(r.status, 201); assert.equal(r.body.unitsToShow.length, 2); assert.notEqual(r.body.unitsToShow[0].id, r.body.unitsToShow[1].id);
    });

    await ctx.test('storage failing while fingerprinting gives a clean error and keeps the challenge usable', async () => {
      const p2 = (await h.call('POST', `/orgs/${org.id}/properties`, { name: 'Second Court', addressText: 'Second Rd', latitude: PIN.lat - 0.07, longitude: PIN.lon + 0.07 }, admin.accessToken)).body;
      await h.call('POST', `/orgs/${org.id}/properties/${p2.id}/units`, { label: 'S1', bedrooms: 1 }, admin.accessToken); await addT1(p2.id);
      const T2P = `/orgs/${org.id}/properties/${p2.id}/verification/t2`, F2 = `/orgs/${org.id}/properties/${p2.id}/files`;
      const c2 = (await h.call('POST', `${T2P}/challenge`, { consent: true }, admin.accessToken)).body;
      const tk = (await h.call('POST', `${T2P}/challenge/${c2.id}/take`, { mimeType: 'video/mp4', sizeBytes: 400 }, admin.accessToken)).body;
      fake.put((await h.pool.query('SELECT storage_path FROM supply.files WHERE id=$1', [tk.fileId])).rows[0].storage_path, mp4(9));
      assert.equal((await h.call('POST', `${F2}/${tk.fileId}/complete`, undefined, admin.accessToken)).status, 200);
      const body = { challengeId: c2.id, fileId: tk.fileId, start: { lat: PIN.lat - 0.0699, lon: PIN.lon + 0.07, accuracyM: 8, at: iso(0) }, end: { lat: PIN.lat - 0.0698, lon: PIN.lon + 0.07, accuracyM: 8, at: iso(30) } };
      const orig = fake.sha256.bind(fake); fake.sha256 = async () => { throw new Error('down'); };
      try { assert.equal((await h.call('POST', `${T2P}/submit`, body, admin.accessToken)).status, 502); } finally { fake.sha256 = orig; }
      assert.equal((await h.call('POST', `${T2P}/submit`, body, admin.accessToken)).status, 201, 'the same challenge still works afterwards');
    });
  } finally { delete process.env.T2_ENABLED; await h.close(); }
});
