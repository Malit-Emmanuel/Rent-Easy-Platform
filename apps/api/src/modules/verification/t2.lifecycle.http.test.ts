import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { bootApp } from '../../test-utils/http';

process.env.STORAGE_DRIVER = 'fake';
const t = process.env.DATABASE_URL ? test : test.skip;

// Each run uses its own bytes and positions, so earlier runs against the same database cannot trigger the reuse hints.
const RUN = Array.from({ length: 8 }, () => Math.floor(Math.random() * 256));
const mp4 = (seed: number) => Uint8Array.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32, ...RUN, ...new Array(380).fill(seed)]);
const YES = { code_heard: true, place_matches_address: true, units_shown: true, footage_continuous: true, location_close: true, matches_documents: true };

t('T2 lifecycle over HTTP: expiry, renewal, T1 dependency, pin move, reviewer withdrawal, and the video deletion job', async (ctx) => {
  process.env.T2_ENABLED = 'true';
  const h = await bootApp();
  try {
    const { STORAGE_PORT } = await import('../supply/files/storage.port');
    const fake: any = h.app.get(STORAGE_PORT);
    const { T2RetentionService } = await import('./t2.retention');
    const retention = h.app.get(T2RetentionService);
    const mgr = await h.login(), r1 = await h.login(), r2 = await h.login();
    const mgrId = await h.userId(mgr.p), r1Id = await h.userId(r1.p), r2Id = await h.userId(r2.p);
    const org = (await h.call('POST', '/orgs', { name: 'Lifecycle Videos', kind: 'agency' }, mgr.accessToken)).body;
    for (const id of [r1Id, r2Id]) await h.pool.query(`INSERT INTO identity.platform_roles (user_id, role) VALUES ($1,'reviewer')`, [id]);
    await h.pool.query(`INSERT INTO verification.badges (subject_type, subject_id, level, expires_at) VALUES ('user',$1,'id_verified', now() + interval '1 year')`, [mgrId]);

    let n = 0;
    const base = { lat: -1.0 - Math.random() * 0.6, lon: 36.2 + Math.random() * 0.6 };
    /** A property with a valid T1 and one unit, then a real T2 submission. Optionally takes it to approval. */
    const build = async (label: string, approve: boolean) => {
      n++;
      const pin = { lat: base.lat - n * 0.04, lon: base.lon + n * 0.04 };
      const p = (await h.call('POST', `/orgs/${org.id}/properties`, { name: label, addressText: `${label} Road`, latitude: pin.lat, longitude: pin.lon }, mgr.accessToken)).body;
      await h.call('POST', `/orgs/${org.id}/properties/${p.id}/units`, { label: 'U1', bedrooms: 1 }, mgr.accessToken);
      const doc = randomUUID();
      await h.pool.query(`INSERT INTO supply.files (id, org_id, property_id, kind, doc_type, storage_path, original_name, mime_type, size_bytes, uploaded_by, status) VALUES ($1,$2,$3,'document','title_deed',$4,'deed.pdf','application/pdf',100,$5,'ready')`, [doc, org.id, p.id, `docs/${p.id}/deed.pdf`, mgrId]);
      fake.put(`docs/${p.id}/deed.pdf`, Uint8Array.from([37, 80, 68, 70]));
      const t1 = (await h.pool.query(`INSERT INTO verification.badges (subject_type, subject_id, level, expires_at) VALUES ('property',$1,'t1_documented', now() + interval '1 year') RETURNING id`, [p.id])).rows[0].id;
      const T = `/orgs/${org.id}/properties/${p.id}/verification/t2`;
      const submit = async () => {
        const ch = (await h.call('POST', `${T}/challenge`, { consent: true }, mgr.accessToken)); assert.equal(ch.status, 201, JSON.stringify(ch.body));
        const bytes = mp4(n * 7 + Math.floor(Math.random() * 200));
        const tk = (await h.call('POST', `${T}/challenge/${ch.body.id}/take`, { mimeType: 'video/mp4', sizeBytes: bytes.length }, mgr.accessToken)).body;
        const path = (await h.pool.query('SELECT storage_path FROM supply.files WHERE id=$1', [tk.fileId])).rows[0].storage_path;
        fake.put(path, bytes);
        await h.call('POST', `/orgs/${org.id}/properties/${p.id}/files/${tk.fileId}/complete`, undefined, mgr.accessToken);
        return { ch: ch.body, fileId: tk.fileId as string, path: path as string, bytes };
      };
      const sendIt = async (tk: { ch: any; fileId: string }) => {
        const iso = (s: number) => new Date(Date.now() + s * 1000).toISOString();
        const sub = await h.call('POST', `${T}/submit`, { challengeId: tk.ch.id, fileId: tk.fileId, start: { lat: pin.lat + 0.0002, lon: pin.lon, accuracyM: 12, at: iso(0) }, end: { lat: pin.lat + 0.0003, lon: pin.lon, accuracyM: 12, at: iso(45) } }, mgr.accessToken);
        assert.equal(sub.status, 201, JSON.stringify(sub.body)); return sub.body.caseId as string;
      };
      let caseId = '', fileId = '', path = '', badgeId = '';
      if (approve) {
        const tk = await submit(); fileId = tk.fileId; path = tk.path; caseId = await sendIt(tk);
        assert.equal((await h.call('POST', `/review/cases/${caseId}/claim`, undefined, r1.accessToken)).status, 200);
        await h.call('POST', `/review/cases/${caseId}/video/link`, undefined, r1.accessToken); await h.call('POST', `/review/cases/${caseId}/files/${doc}/link`, undefined, r1.accessToken);
        const ok = await h.call('POST', `/review/cases/${caseId}/decision`, { decision: 'approve', checklist: YES }, r1.accessToken);
        assert.equal(ok.status, 200, JSON.stringify(ok.body)); badgeId = ok.body.badgeId;
      }
      return { pin, propertyId: p.id as string, T, doc, t1, submit, sendIt, caseId, fileId, path, badgeId };
    };
    const status = async (T: string) => (await h.call('GET', T, undefined, mgr.accessToken)).body;
    const cols = async (id: string) => (await h.pool.query('SELECT level, revoked_at, revoke_reason_code, anchor_lat, anchor_lon, expires_at FROM verification.badges WHERE id=$1', [id])).rows[0];

    const a = await build('Lifecycle A', true);

    await ctx.test('an approved video badge shows its end date, remembers where it was approved, and blocks a second request', async () => {
      const s = await status(a.T);
      assert.ok(s.badge && s.badge.renewable === false); assert.equal(s.suspended, null); assert.equal(s.badgeEnded, null);
      assert.equal(new Date(s.badge.validUntil).toISOString(), new Date(s.badge.ownExpiry).toISOString(), 'T2 ends before T1 here');
      assert.ok(s.blockers.includes('already_t2'));
      assert.equal((await h.call('POST', `${a.T}/challenge`, { consent: true }, mgr.accessToken)).status, 409);
      const b = await cols(a.badgeId); assert.equal(b.level, 't2_video'); assert.ok(Math.abs(b.anchor_lat - (a.pin.lat)) < 1e-6 && Math.abs(b.anchor_lon - a.pin.lon) < 1e-6);
    });

    await ctx.test('in the last 30 days the manager may renew; the old badge keeps counting meanwhile', async () => {
      await h.pool.query(`UPDATE verification.badges SET expires_at = now() + interval '20 days' WHERE id=$1`, [a.badgeId]);
      const s = await status(a.T);
      assert.equal(s.badge.renewable, true); assert.ok(!s.blockers.includes('already_t2'), JSON.stringify(s.blockers));
      const ch = await h.call('POST', `${a.T}/challenge`, { consent: true }, mgr.accessToken); assert.equal(ch.status, 201, JSON.stringify(ch.body));
      await h.pool.query(`UPDATE verification.t2_challenges SET used_at = now() WHERE id=$1`, [ch.body.id]);   // leave it spent
      await h.pool.query(`UPDATE verification.badges SET expires_at = now() + interval '5 months' WHERE id=$1`, [a.badgeId]);
    });

    await ctx.test('a video badge counts only while T1 is valid: it is suspended when T1 lapses and returns with a new T1', async () => {
      await h.pool.query(`UPDATE verification.badges SET revoked_at = now(), revoke_reason_code = 'doc_expired' WHERE id=$1`, [a.t1]);
      const s = await status(a.T);
      assert.equal(s.badge, null); assert.ok(s.suspended && s.suspended.validUntil); assert.ok(s.blockers.includes('no_valid_t1'));
      const list = (await h.call('GET', '/review/badges', undefined, r2.accessToken)).body as any[];
      const row = list.find((x) => x.id === a.badgeId); assert.ok(row && row.tier === 't2' && row.suspended === true, 'the reviewer sees it, marked suspended');
      assert.ok(!(await h.pool.query(`SELECT 1 FROM verification.property_badge_status WHERE property_id=$1 AND t2_effective_until IS NOT NULL`, [a.propertyId])).rowCount);
      await h.pool.query(`INSERT INTO verification.badges (subject_type, subject_id, level, expires_at) VALUES ('property',$1,'t1_documented', now() + interval '1 year')`, [a.propertyId]);
      const back = await status(a.T); assert.ok(back.badge && back.suspended === null);
      const list2 = (await h.call('GET', '/review/badges', undefined, r2.accessToken)).body as any[];
      assert.equal(list2.find((x) => x.id === a.badgeId).suspended, false);
    });

    await ctx.test('the reviewer who decided still sees their own organisation excluded; another reviewer can list and withdraw the video badge with a video reason', async () => {
      const own = await h.call('POST', `/review/badges/${a.badgeId}/revoke`, { reasonCode: 'doc_expired' }, r2.accessToken);
      assert.equal(own.status, 400, 'document reasons do not apply to a video badge');
      assert.equal((await h.call('POST', `/review/badges/${a.badgeId}/revoke`, { reasonCode: 'other' }, r2.accessToken)).status, 400, 'other needs a note');
      assert.equal((await h.call('POST', `/review/badges/${a.badgeId}/revoke`, { reasonCode: 't2_suspected_replay' }, mgr.accessToken)).status, 403);
      const ok = await h.call('POST', `/review/badges/${a.badgeId}/revoke`, { reasonCode: 't2_suspected_replay', note: 'Screen recording' }, r2.accessToken);
      assert.equal(ok.status, 200, JSON.stringify(ok.body));
      const b = await cols(a.badgeId); assert.ok(b.revoked_at); assert.equal(b.revoke_reason_code, 't2_suspected_replay');
      assert.equal((await h.call('POST', `/review/badges/${a.badgeId}/revoke`, { reasonCode: 't2_suspected_replay' }, r2.accessToken)).status, 404, 'already withdrawn');
      const s = await status(a.T);
      assert.equal(s.badge, null); assert.equal(s.badgeEnded.kind, 'revoked'); assert.equal(s.badgeEnded.reasonCode, 't2_suspected_replay'); assert.ok(!JSON.stringify(s).includes(r2Id), 'the manager never learns who withdrew it');
      const hist = (await h.call('GET', '/review/cases/history', undefined, r2.accessToken)).body as any[];
      assert.ok(hist.some((x) => x.kind === 'badge_revoked' && x.tier === 't2'));
      assert.equal((await h.pool.query(`SELECT count(*)::int n FROM verification.badges WHERE subject_id=$1 AND level='t1_documented' AND revoked_at IS NULL AND expires_at > now()`, [a.propertyId])).rows[0].n, 1, 'the renewed T1 is untouched');
      const ev = (await h.pool.query(`SELECT metadata FROM governance.audit_events WHERE action='verification.badge_revoked' AND subject_id=$1`, [a.badgeId])).rows[0].metadata;
      assert.deepEqual(Object.keys(ev).sort(), ['flagged', 'orgId', 'propertyId', 'reasonCode', 'tier']); assert.equal(ev.flagged, true);
    });

    const b2 = await build('Lifecycle B', true);
    await ctx.test('moving the pin by more than 100 m from where it was approved ends the video badge, not T1; small moves do not', async () => {
      const move = (lat: number, lon: number) => h.call('PATCH', `/orgs/${org.id}/properties/${b2.propertyId}`, { latitude: lat, longitude: lon }, mgr.accessToken);
      assert.equal((await move(b2.pin.lat + 0.00054, b2.pin.lon)).status, 200);          // about 60 m
      assert.ok((await status(b2.T)).badge, 'a 60 m move keeps it');
      assert.equal((await move(b2.pin.lat + 0.00108, b2.pin.lon)).status, 200);          // 120 m from the approved position
      const s = await status(b2.T);
      assert.equal(s.badge, null); assert.equal(s.badgeEnded.kind, 'revoked'); assert.equal(s.badgeEnded.reasonCode, 't2_position_moved');
      assert.equal((await cols(b2.badgeId)).revoke_reason_code, 't2_position_moved');
      assert.equal((await h.pool.query(`SELECT revoked_at FROM verification.badges WHERE id=$1`, [b2.t1])).rows[0].revoked_at, null);
      const ev = (await h.pool.query(`SELECT metadata, actor_id FROM governance.audit_events WHERE action='verification.badge_revoked' AND subject_id=$1`, [b2.badgeId])).rows[0];
      assert.equal(ev.metadata.reasonCode, 't2_position_moved'); assert.ok(ev.metadata.movedM > 100); assert.ok(!('lat' in ev.metadata) && !('lon' in ev.metadata));
      assert.ok(!(await status(b2.T)).blockers.includes('already_t2'), 'a new video check can be requested');
    });

    const c = await build('Lifecycle C', true);
    const u = await build('Lifecycle D (never submitted)', false);
    await ctx.test('deletion job: removes a video 90 days after the final decision, keeps younger ones, never touches the case record', async () => {
      const young = c;   // decided just now: must survive
      const old = await build('Lifecycle E', true);
      assert.ok(fake.objects.has(old.path) && fake.objects.has(young.path));
      const cx = await h.pool.connect();
      try {   // time travel: move the decision back (the table rules that stop edits are switched off inside this transaction only)
        await cx.query('BEGIN'); await cx.query('ALTER TABLE verification.cases DISABLE TRIGGER USER');
        await cx.query(`UPDATE verification.cases SET decided_at = now() - interval '91 days', submitted_at = now() - interval '100 days', due_at = now() - interval '95 days' WHERE id=$1`, [old.caseId]);
        await cx.query(`UPDATE verification.cases SET decided_at = now() - interval '89 days', submitted_at = now() - interval '100 days', due_at = now() - interval '95 days' WHERE id=$1`, [young.caseId]);
        await cx.query('ALTER TABLE verification.cases ENABLE TRIGGER USER'); await cx.query('COMMIT');
      } catch (e) { await cx.query('ROLLBACK').catch(() => {}); throw e; } finally { cx.release(); }
      const before = (await h.pool.query(`SELECT status, reason_code, t2_checklist FROM verification.cases WHERE id=$1`, [old.caseId])).rows[0];
      const out = await retention.purge();
      assert.ok(out.retention >= 1 && out.failed === 0, JSON.stringify(out));
      assert.equal((await h.pool.query(`SELECT status FROM supply.files WHERE id=$1`, [old.fileId])).rows[0].status, 'deleted');
      assert.equal(fake.objects.has(old.path), false, 'the stored bytes are gone');
      assert.equal((await h.pool.query(`SELECT status FROM supply.files WHERE id=$1`, [young.fileId])).rows[0].status, 'ready');
      assert.equal(fake.objects.has(young.path), true);
      assert.equal(fake.objects.has(old.doc ? `docs/${old.propertyId}/deed.pdf` : ''), true, 'documents are never touched by the video job');
      const after = (await h.pool.query(`SELECT status, reason_code, t2_checklist FROM verification.cases WHERE id=$1`, [old.caseId])).rows[0];
      assert.deepEqual(after, before, 'the case, its decision and the checklist stay');
      assert.equal((await h.pool.query(`SELECT count(*)::int n FROM verification.t2_evidence WHERE case_id=$1 AND video_sha256 IS NOT NULL`, [old.caseId])).rows[0].n, 1, 'the fingerprint stays');
      const ev = (await h.pool.query(`SELECT metadata FROM governance.audit_events WHERE action='verification.t2_videos_purged' ORDER BY id DESC LIMIT 1`)).rows[0].metadata;
      assert.deepEqual(Object.keys(ev).sort(), ['failed', 'retention', 'unsubmitted'], 'counts only');
      const again = await retention.purge(); assert.equal(again.retention, 0, 'nothing left to do');
      // a reviewer who opens the old case sees that the video is gone, and cannot be given a link to it
      assert.equal((await h.call('POST', `/review/cases/${old.caseId}/video/link`, undefined, r1.accessToken)).status, 404);
    });

    await ctx.test('deletion job: a recording that was never sent is removed a day after its challenge ended, and not before', async () => {
      const tk = await u.submit();
      assert.ok(fake.objects.has(tk.path));
      const first = await retention.purge(); assert.equal((await h.pool.query(`SELECT status FROM supply.files WHERE id=$1`, [tk.fileId])).rows[0].status, 'ready', JSON.stringify(first));
      const cx = await h.pool.connect();
      try {
        await cx.query('BEGIN'); await cx.query('ALTER TABLE verification.t2_challenges DISABLE TRIGGER USER');
        await cx.query(`UPDATE verification.t2_challenges SET issued_at = now() - interval '26 hours', expires_at = now() - interval '25 hours 30 minutes', consent_at = now() - interval '26 hours' WHERE id=$1`, [tk.ch.id]);
        await cx.query('ALTER TABLE verification.t2_challenges ENABLE TRIGGER USER'); await cx.query('COMMIT');
      } catch (e) { await cx.query('ROLLBACK').catch(() => {}); throw e; } finally { cx.release(); }
      const out = await retention.purge(); assert.ok(out.unsubmitted >= 1, JSON.stringify(out));
      assert.equal((await h.pool.query(`SELECT status FROM supply.files WHERE id=$1`, [tk.fileId])).rows[0].status, 'deleted');
      assert.equal(fake.objects.has(tk.path), false);
    });

    await ctx.test('the job is registered and reachable through the cron endpoint only with the secret', async () => {
      const { JobsService } = await import('../jobs/jobs.service');
      const jobs = h.app.get(JobsService);
      assert.ok(jobs.schedules.some((s) => s.name === 'purge-t2-videos' && s.everyMs === 24 * 3600 * 1000));
      assert.equal(typeof jobs.handlers['purge-t2-videos'], 'function');
      assert.equal((await h.call('GET', '/internal/cron/purge-t2-videos')).status, 401);
    });
  } finally { delete process.env.T2_ENABLED; await h.close(); }
});
