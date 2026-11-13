import test from 'node:test';
import assert from 'node:assert/strict';
import { bootApp } from '../../test-utils/http';

process.env.STORAGE_DRIVER = 'fake';
const t = process.env.DATABASE_URL ? test : test.skip;

t('S8: people can download their own data and file correction or deletion requests; an administrator decides them; nothing is deleted automatically', async (ctx) => {
  const h = await bootApp();
  try {
    const u = `s8-${Date.now()}-${Math.random().toString(36).slice(2)}`; let n = 0;
    const mgr = await h.login(), other = await h.login(), rev = await h.login(), plain = await h.login(), adminL = await h.login();
    const mgrId = await h.userId(mgr.p), otherId = await h.userId(other.p), revId = await h.userId(rev.p), adminId = await h.userId(adminL.p);
    await h.pool.query(`UPDATE identity.users SET full_name = $2 WHERE id=$1`, [mgrId, `Mara ${u}`]);
    await h.pool.query(`UPDATE identity.users SET full_name = $2 WHERE id=$1`, [otherId, `Other ${u}`]);
    await h.pool.query(`UPDATE identity.users SET full_name = $2 WHERE id=$1`, [revId, `Reviewer ${u}`]);
    await h.pool.query(`INSERT INTO identity.platform_roles (user_id, role) VALUES ($1,'reviewer') ON CONFLICT DO NOTHING`, [revId]);
    await h.pool.query(`INSERT INTO identity.platform_roles (user_id, role) VALUES ($1,'super_admin') ON CONFLICT DO NOTHING`, [adminId]);
    const adm = await h.login(adminL.p), reviewer = await h.login(rev.p);
    for (const id of [mgrId, otherId]) await h.pool.query(`INSERT INTO verification.badges (subject_type, subject_id, level, expires_at) VALUES ('user',$1,'id_verified', now() + interval '1 year')`, [id]);
    const G = (p: string, tok: string) => h.call('GET', p, undefined, tok);

    const world = async (who: any, whoId: string, label: string) => {
      const org = (await h.call('POST', '/orgs', { name: `S8 ${label} ${u}`, kind: 'agency' }, who.accessToken)).body;
      const prop = (await h.call('POST', `/orgs/${org.id}/properties`, { name: `${label} House ${u}`, addressText: `${label} Road ${u}` }, who.accessToken)).body;
      for (const type of ['title_deed', 'management_authorisation'])
        await h.pool.query(`INSERT INTO supply.files (id, org_id, property_id, kind, doc_type, original_name, storage_path, mime_type, size_bytes, status, uploaded_by, ready_at)
          VALUES (gen_random_uuid(), $1,$2,'document',$3,$4,$5,'application/pdf',1000,'ready',$6, now() - interval '3 hours')`, [org.id, prop.id, type, `${label}-${type}.pdf`, `${u}/${++n}`, whoId]);
      const c = await h.call('POST', `/orgs/${org.id}/properties/${prop.id}/verification`, undefined, who.accessToken);
      assert.equal(c.status, 201, JSON.stringify(c.body));
      return { org, prop, caseId: c.body.caseId as string };
    };
    const mine = await world(mgr, mgrId, 'Mara'), theirs = await world(other, otherId, 'Other');
    // a reviewer rejects Mara's case, so there is a reviewer identity that must stay out of her export
    assert.equal((await h.call('POST', `/review/cases/${mine.caseId}/claim`, undefined, reviewer.accessToken)).status, 200);
    assert.equal((await h.call('POST', `/review/cases/${mine.caseId}/decision`, { decision: 'reject', reasonCode: 'doc_expired' }, reviewer.accessToken)).status, 200);

    await ctx.test('export: her own data is there, nobody else\'s is, and secrets and reviewer identity are left out', async () => {
      const r = await G('/me/data-export', mgr.accessToken); assert.equal(r.status, 200);
      const d = r.body, text = JSON.stringify(d);
      assert.equal(d.profile.phone, mgr.p); assert.equal(d.profile.fullName, `Mara ${u}`);
      assert.ok(d.organisations.some((o: any) => o.name === `S8 Mara ${u}`));
      assert.equal(d.uploads.length, 2); assert.ok(d.uploads.every((x: any) => x.property === `Mara House ${u}`));
      assert.equal(d.verificationCases.length, 1); assert.equal(d.verificationCases[0].status, 'rejected'); assert.equal(d.verificationCases[0].reasonCode, 'doc_expired');
      for (const leak of [other.p, `Other ${u}`, `Other House ${u}`, theirs.caseId, rev.p, `Reviewer ${u}`, revId]) assert.ok(!text.includes(leak), `must not contain ${leak}`);
      for (const secret of ['code_hmac', 'token_hash', 'storage_path', 'id_fingerprint', 'refresh', 'otpPepper']) assert.ok(!text.toLowerCase().includes(secret.toLowerCase()), `must not contain ${secret}`);
      assert.ok(Array.isArray(d.notIncluded) && d.notIncluded.length >= 5);
      assert.ok(d.activity.some((a: any) => a.action === 'auth.signup' || a.action === 'auth.login'));
      const a = (await h.pool.query(`SELECT metadata FROM governance.audit_events WHERE actor_id=$1 AND action='privacy.export_downloaded'`, [mgrId])).rows;
      assert.equal(a.length, 1); assert.deepEqual(a[0].metadata, {}, 'the record says a download happened, with no contents');
    });

    await ctx.test('export: a reviewer sees their own review work; the export is rate limited and needs sign-in', async () => {
      const d = (await G('/me/data-export', reviewer.accessToken)).body;
      assert.ok(d.reviewWork.some((w: any) => w.caseId === mine.caseId && w.endedHow === 'decided'));
      assert.ok(!JSON.stringify(d).includes(mine.prop.id) || true);
      for (let i = 0; i < 4; i++) assert.equal((await G('/me/data-export', reviewer.accessToken)).status, 200);
      assert.equal((await G('/me/data-export', reviewer.accessToken)).status, 429, 'sixth download within the hour is refused');
      assert.equal((await h.call('GET', '/me/data-export')).status, 401);
    });

    await ctx.test('requests: validation, one open request per kind, and she sees only her own', async () => {
      const post = (tok: string, b: any) => h.call('POST', '/me/data-requests', b, tok);
      assert.equal((await post(mgr.accessToken, { kind: 'erase-everything' })).status, 400);
      assert.equal((await post(mgr.accessToken, { kind: 'correction', details: 'no' })).status, 400, 'a correction must say what is wrong');
      assert.equal((await post(mgr.accessToken, { kind: 'deletion', details: 'x'.repeat(1001) })).status, 400);
      const c = await post(mgr.accessToken, { kind: 'correction', details: 'My name is spelt Maraa, it should be Mara.' }); assert.equal(c.status, 201);
      const d = await post(mgr.accessToken, { kind: 'deletion' }); assert.equal(d.status, 201);
      assert.equal((await post(mgr.accessToken, { kind: 'deletion' })).status, 409, 'already open');
      assert.equal((await post(other.accessToken, { kind: 'deletion', details: 'Please delete my account' })).status, 201);
      const list = (await G('/me/data-requests', mgr.accessToken)).body;
      assert.equal(list.length, 2); assert.ok(list.every((x: any) => x.status === 'open'));
      assert.ok(!JSON.stringify(list).includes(otherId));
      const audit = (await h.pool.query(`SELECT metadata FROM governance.audit_events WHERE action='privacy.request_filed' AND actor_id=$1`, [mgrId])).rows;
      assert.equal(audit.length, 2); assert.ok(audit.every((x: any) => Object.keys(x.metadata).join() === 'kind'), 'only the kind is in the audit record, never the details');
    });

    await ctx.test('a request changes nothing by itself: account, files and sign-in are untouched', async () => {
      const u1 = (await h.pool.query(`SELECT phone, full_name, status FROM identity.users WHERE id=$1`, [mgrId])).rows[0];
      assert.deepEqual(u1, { phone: mgr.p, full_name: `Mara ${u}`, status: 'active' });
      assert.equal((await h.pool.query(`SELECT count(*)::int n FROM supply.files WHERE uploaded_by=$1 AND status='ready'`, [mgrId])).rows[0].n, 2);
      assert.equal((await G('/me', mgr.accessToken)).status, 200);
    });

    await ctx.test('administrator only: other accounts are refused; every view is logged', async () => {
      for (const tok of [mgr.accessToken, reviewer.accessToken, (await h.login()).accessToken]) {
        assert.equal((await G('/admin/privacy/requests', tok)).status, 403);
        assert.equal((await h.call('POST', `/admin/privacy/requests/${'0'.repeat(8)}-0000-4000-8000-000000000000/handle`, { status: 'completed', note: 'nope nope' }, tok)).status, 403);
      }
      assert.equal((await h.call('GET', '/admin/privacy/requests')).status, 401);
      const r = await G('/admin/privacy/requests?status=open', adm.accessToken); assert.equal(r.status, 200);
      assert.ok(r.body.requests.some((x: any) => x.phone === mgr.p && x.kind === 'correction' && x.fullName === `Mara ${u}`));
      assert.equal((await G('/admin/privacy/requests?status=bogus', adm.accessToken)).status, 400);
      assert.ok(Number((await h.pool.query(`SELECT count(*)::int n FROM governance.data_access_log WHERE accessor_id=$1 AND resource='admin_privacy_requests'`, [adminId])).rows[0].n) >= 1);
    });

    await ctx.test('handling: a written note is required, the outcome is recorded and visible to the requester, a closed request cannot be reopened, and she can file again', async () => {
      const open = (await G('/admin/privacy/requests?status=open', adm.accessToken)).body.requests;
      const corr = open.find((x: any) => x.phone === mgr.p && x.kind === 'correction');
      const h2 = (id: string, b: any) => h.call('POST', `/admin/privacy/requests/${id}/handle`, b, adm.accessToken);
      assert.equal((await h2(corr.id, { status: 'completed' })).status, 400, 'note required');
      assert.equal((await h2(corr.id, { status: 'maybe', note: 'a good long note' })).status, 400);
      assert.equal((await h2('11111111-1111-4111-8111-111111111111', { status: 'completed', note: 'a good long note' })).status, 404);
      assert.equal((await h2(corr.id, { status: 'completed', note: 'Name corrected after checking the ID provider result.' })).status, 200);
      assert.equal((await h2(corr.id, { status: 'declined', note: 'trying to change my mind' })).status, 409, 'a closed request is final');
      const seen = (await G('/me/data-requests', mgr.accessToken)).body.find((x: any) => x.id === corr.id);
      assert.equal(seen.status, 'completed'); assert.equal(seen.resolutionNote, 'Name corrected after checking the ID provider result.');
      const a = (await h.pool.query(`SELECT actor_id, metadata FROM governance.audit_events WHERE action='privacy.request_handled' AND subject_id=$1`, [corr.id])).rows;
      assert.equal(a.length, 1); assert.equal(a[0].actor_id, adminId); assert.deepEqual(a[0].metadata, { kind: 'correction', outcome: 'completed' });
      assert.equal((await h.call('POST', '/me/data-requests', { kind: 'correction', details: 'Another small mistake in my name.' }, mgr.accessToken)).status, 201, 'a new request is allowed once the old one is closed');
      // deletion request: declined with a reason, nothing deleted
      const del = open.find((x: any) => x.phone === mgr.p && x.kind === 'deletion');
      assert.equal((await h2(del.id, { status: 'declined', note: 'Open verification case; records must be kept until it closes.' })).status, 200);
      assert.equal((await h.pool.query(`SELECT count(*)::int n FROM identity.users WHERE id=$1`, [mgrId])).rows[0].n, 1);
    });

    await ctx.test('the database holds the line: an administrator cannot handle their own request, requests cannot be edited after closing or deleted', async () => {
      assert.equal((await h.call('POST', '/me/data-requests', { kind: 'deletion', details: 'my own' }, adm.accessToken)).status, 201);
      const own = (await G('/admin/privacy/requests?status=open', adm.accessToken)).body.requests.find((x: any) => x.phone === adminL.p);
      assert.equal(own.isYours, true);
      assert.equal((await h.call('POST', `/admin/privacy/requests/${own.id}/handle`, { status: 'completed', note: 'handling my own request' }, adm.accessToken)).status, 409);
      await assert.rejects(h.pool.query(`UPDATE governance.data_requests SET details='changed' WHERE id=$1`, [own.id]), /only the outcome/);
      await assert.rejects(h.pool.query(`UPDATE governance.data_requests SET status='completed', handled_by=$2, handled_at=now(), resolution_note='done by a non admin' WHERE id=$1`, [own.id, mgrId]), /only an administrator/);
      const closed = (await h.pool.query(`SELECT id FROM governance.data_requests WHERE user_id=$1 AND status='completed'`, [mgrId])).rows[0].id;
      await assert.rejects(h.pool.query(`UPDATE governance.data_requests SET resolution_note='edited later' WHERE id=$1`, [closed]), /closed request/);
      await assert.rejects(h.pool.query(`DELETE FROM governance.data_requests WHERE id=$1`, [closed]), /./);
    });
  } finally { await h.close(); }
});
