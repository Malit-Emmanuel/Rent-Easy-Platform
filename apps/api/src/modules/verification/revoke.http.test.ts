import test from 'node:test';
import assert from 'node:assert/strict';
import { bootApp } from '../../test-utils/http';

process.env.STORAGE_DRIVER = 'fake';
const t = process.env.DATABASE_URL ? test : test.skip;

t('badge revoke, expiry and final appeals over HTTP', async (ctx) => {
  const h = await bootApp();
  try {
    const mgr = await h.login(), rev = await h.login(), insider = await h.login();
    const org = (await h.call('POST', '/orgs', { name: 'Revoke Agents', kind: 'agency' }, mgr.accessToken)).body;
    const mgrId = await h.userId(mgr.p), revId = await h.userId(rev.p), insId = await h.userId(insider.p);
    for (const id of [revId, insId]) await h.pool.query(`INSERT INTO identity.platform_roles (user_id, role) VALUES ($1,'reviewer') ON CONFLICT DO NOTHING`, [id]);
    await h.pool.query(`INSERT INTO identity.memberships (user_id, org_id, role) VALUES ($1,$2,'manager_staff')`, [insId, org.id]);
    await h.pool.query(`INSERT INTO verification.badges (subject_type, subject_id, level, expires_at) VALUES ('user',$1,'id_verified', now() + interval '1 year')`, [mgrId]);
    const prop = async (name: string) => (await h.call('POST', `/orgs/${org.id}/properties`, { name, addressText: `${name} Road` }, mgr.accessToken)).body;
    const badge = async (pid: string, daysLeft = 300) => (await h.pool.query(
      `INSERT INTO verification.badges (subject_type, subject_id, level, verified_by, issued_at, expires_at) VALUES ('property',$1,'t1_documented',$2, now() - interval '10 days', now() + $3 * interval '1 day') RETURNING id`, [pid, revId, daysLeft])).rows[0].id as string;
    const V = (pid: string) => `/orgs/${org.id}/properties/${pid}/verification`;
    const REV = (id: string, body: any, r = rev) => h.call('POST', `/review/badges/${id}/revoke`, body, r.accessToken);

    const pA = await prop('Alpha'), bA = await badge(pA.id, 20), pB = await prop('Bravo'), bB = await badge(pB.id, 200);

    await ctx.test('the list is for reviewers only and hides the reviewer\'s own organisations', async () => {
      assert.equal((await h.call('GET', '/review/badges', undefined, mgr.accessToken)).status, 403);
      assert.equal((await h.call('GET', '/review/badges')).status, 401);
      const mine = ((await h.call('GET', '/review/badges', undefined, rev.accessToken)).body as any[]).filter((b) => [bA, bB].includes(b.id));
      assert.deepEqual(mine.map((b) => b.id), [bA, bB], 'soonest to expire first');
      assert.equal(((await h.call('GET', '/review/badges', undefined, insider.accessToken)).body as any[]).filter((b) => [bA, bB].includes(b.id)).length, 0);
    });

    await ctx.test('revoking needs a reason, a reviewer outside the organisation, and an active badge', async () => {
      for (const body of [{}, { reasonCode: 'nope' }, { reasonCode: 'other' }, { reasonCode: 'doc_expired', note: 'x'.repeat(501) }]) assert.equal((await REV(bA, body)).status, 400, JSON.stringify(body));
      assert.equal((await REV(bA, { reasonCode: 'doc_expired' }, insider)).status, 404, 'no self-review');
      assert.equal((await h.call('POST', `/review/badges/${bA}/revoke`, { reasonCode: 'doc_expired' }, mgr.accessToken)).status, 403);
      assert.equal((await REV('00000000-0000-4000-8000-000000000000', { reasonCode: 'doc_expired' })).status, 404);
      assert.equal((await h.pool.query('SELECT revoked_at FROM verification.badges WHERE id=$1', [bA])).rows[0].revoked_at, null);
    });

    await ctx.test('a revoked property stops counting at once; the manager sees the reason, never the reviewer', async () => {
      const before = (await h.call('GET', V(pA.id), undefined, mgr.accessToken)).body; assert.equal(before.verified, true); assert.equal(before.badgeEnded, null);
      const r = await REV(bA, { reasonCode: 'suspected_forgery', note: 'Seal copied from another deed' });
      assert.equal(r.status, 200);
      const s = (await h.call('GET', V(pA.id), undefined, mgr.accessToken)).body;
      assert.equal(s.verified, false); assert.equal(s.verifiedUntil, null); assert.equal(s.canRequest, true);
      assert.equal(s.badgeEnded.kind, 'revoked'); assert.equal(s.badgeEnded.reasonCode, 'suspected_forgery'); assert.equal(s.badgeEnded.note, 'Seal copied from another deed');
      assert.ok(!JSON.stringify(s).includes(revId));
      const list = (await h.call('GET', `/orgs/${org.id}/properties`, undefined, mgr.accessToken)).body as any[];
      assert.equal(list.find((p) => p.id === pA.id).verifiedUntil, null);
      assert.equal(list.find((p) => p.id === pB.id).verifiedUntil !== null, true);
      assert.equal((await REV(bA, { reasonCode: 'doc_expired' })).status, 404, 'cannot revoke twice');
      assert.ok(((await h.call('GET', '/review/badges', undefined, rev.accessToken)).body as any[]).every((b) => b.id !== bA));
      await assert.rejects(h.pool.query('UPDATE verification.badges SET revoked_at=NULL WHERE id=$1', [bA]), /revoked badge cannot be changed/);
    });

    await ctx.test('an expired badge never counts, even though nothing ran to expire it', async () => {
      await h.pool.query(`UPDATE verification.badges SET issued_at = now() - interval '13 months', expires_at = now() - interval '1 day' WHERE id=$1`, [bB]);
      const s = (await h.call('GET', V(pB.id), undefined, mgr.accessToken)).body;
      assert.equal(s.verified, false); assert.equal(s.badgeEnded.kind, 'expired'); assert.equal(s.canRequest, true);
      assert.equal(((await h.call('GET', `/orgs/${org.id}/properties`, undefined, mgr.accessToken)).body as any[]).find((p) => p.id === pB.id).verifiedUntil, null);
      assert.ok(((await h.call('GET', '/review/badges', undefined, rev.accessToken)).body as any[]).every((b) => b.id !== bB));
      assert.equal((await REV(bB, { reasonCode: 'doc_expired' })).status, 404, 'an expired badge cannot be revoked, it has ended already');
    });

    await ctx.test('a new request after a revoke is allowed and carries the "previously revoked" flag', async () => {
      const u = `rv-${Date.now()}-${Math.random().toString(36).slice(2)}`; let n = 0;
      for (const type of ['title_deed', 'management_authorisation']) await h.pool.query(
        `INSERT INTO supply.files (id, org_id, property_id, kind, doc_type, original_name, storage_path, mime_type, size_bytes, status, uploaded_by, ready_at)
         VALUES (gen_random_uuid(), $1,$2,'document',$3,'d.pdf',$4,'application/pdf',1000,'ready',$5, now() - interval '3 hours')`, [org.id, pA.id, type, `${u}/${++n}`, mgrId]);
      const r = await h.call('POST', V(pA.id), undefined, mgr.accessToken);
      assert.equal(r.status, 201);
      const flags = (await h.pool.query('SELECT risk_flags FROM verification.cases WHERE id=$1', [r.body.caseId])).rows[0].risk_flags;
      assert.ok(flags.includes('previously_revoked'));
    });

    await ctx.test('renewal opens in the last 30 days and only then', async () => {
      const pR = await prop('Renewable'); const bR = await badge(pR.id, 20);
      const s = (await h.call('GET', V(pR.id), undefined, mgr.accessToken)).body;
      assert.equal(s.verified, true); assert.equal(s.canRequest, true, 'expiring soon: renewal is open');
      const far = await prop('Far'); await badge(far.id, 200);
      assert.equal((await h.call('GET', V(far.id), undefined, mgr.accessToken)).body.canRequest, false);
      assert.equal((await h.call('POST', V(far.id), undefined, mgr.accessToken)).status, 409);
      assert.ok(bR);
    });

    await ctx.test('audit: the revoke is recorded with its reason and flagged for follow-up', async () => {
      const a = (await h.pool.query(`SELECT actor_id, metadata FROM governance.audit_events WHERE action='verification.badge_revoked' AND subject_id=$1`, [bA])).rows;
      assert.equal(a.length, 1); assert.equal(a[0].actor_id, revId); assert.equal(a[0].metadata.reasonCode, 'suspected_forgery'); assert.equal(a[0].metadata.flagged, true);
    });

    await ctx.test('a rejected appeal is final: the manager sees it was an appeal and cannot appeal again', async () => {
      const pC = await prop('Charlie');
      const orig = (await h.pool.query(
        `INSERT INTO verification.cases (org_id, property_id, status, submitted_by, submitted_at, due_at, claimed_by, claimed_at, decided_by, decided_at, reason_code)
         VALUES ($1,$2,'rejected',$3, now() - interval '5 days', now() - interval '3 days', $4, now() - interval '4 days', $4, now() - interval '3 days', 'doc_expired') RETURNING id`, [org.id, pC.id, mgrId, revId])).rows[0].id;
      const u2 = `rv2-${Date.now()}-${Math.random().toString(36).slice(2)}`; let k = 0;
      for (const type of ['title_deed', 'management_authorisation']) await h.pool.query(
        `INSERT INTO supply.files (id, org_id, property_id, kind, doc_type, original_name, storage_path, mime_type, size_bytes, status, uploaded_by, ready_at)
         VALUES (gen_random_uuid(), $1,$2,'document',$3,'d.pdf',$4,'application/pdf',1000,'ready',$5, now() - interval '3 hours')`, [org.id, pC.id, type, `${u2}/${++k}`, mgrId]);
      const s0 = (await h.call('GET', V(pC.id), undefined, mgr.accessToken)).body; assert.equal(s0.case.canAppeal, true);
      const ap = await h.call('POST', V(pC.id) + '/appeal', undefined, mgr.accessToken); assert.equal(ap.status, 201);
      const r3 = await h.login(); const r3Id = await h.userId(r3.p);
      await h.pool.query(`INSERT INTO identity.platform_roles (user_id, role) VALUES ($1,'reviewer') ON CONFLICT DO NOTHING`, [r3Id]);
      await h.call('POST', `/review/cases/${ap.body.caseId}/claim`, undefined, r3.accessToken);
      assert.equal((await h.call('POST', `/review/cases/${ap.body.caseId}/decision`, { decision: 'reject', reasonCode: 'suspected_forgery', note: 'Still not convincing' }, r3.accessToken)).status, 200);
      const s = (await h.call('GET', V(pC.id), undefined, mgr.accessToken)).body;
      assert.equal(s.case.status, 'rejected'); assert.equal(s.case.isAppeal, true); assert.equal(s.case.canAppeal, false);
      assert.equal((await h.call('POST', V(pC.id) + '/appeal', undefined, mgr.accessToken)).status, 409);
      assert.equal((await h.pool.query('SELECT count(*)::int n FROM verification.cases WHERE property_id=$1', [pC.id])).rows[0].n, 2, 'no third case');
    });
  } finally { await h.close(); }
});
