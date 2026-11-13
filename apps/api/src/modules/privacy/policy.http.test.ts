import test from 'node:test';
import assert from 'node:assert/strict';
import { bootApp } from '../../test-utils/http';

process.env.STORAGE_DRIVER = 'fake';
const t = process.env.DATABASE_URL ? test : test.skip;

t('S11: acceptance of the privacy notice and terms is recorded per version; nothing is required until a version is set', async (ctx) => {
  const h = await bootApp();
  const saved = { p: process.env.POLICY_PRIVACY_VERSION, t: process.env.POLICY_TERMS_VERSION };
  try {
    const a = await h.login(), b = await h.login(); const aId = await h.userId(a.p);
    const G = (p: string, tok: string) => h.call('GET', p, undefined, tok), P = (p: string, body: any, tok: string) => h.call('POST', p, body, tok);
    delete process.env.POLICY_PRIVACY_VERSION; delete process.env.POLICY_TERMS_VERSION;

    await ctx.test('no version set: nothing required, and nothing can be accepted', async () => {
      const r = await G('/me/policies', a.accessToken); assert.equal(r.status, 200);
      assert.deepEqual(r.body, { required: false, items: [] });
      assert.equal((await P('/me/policies/accept', { doc: 'privacy', version: 'v1', lang: 'en' }, a.accessToken)).status, 409);
    });

    process.env.POLICY_PRIVACY_VERSION = '2026-12-a'; process.env.POLICY_TERMS_VERSION = '2026-12-a';
    await ctx.test('with versions set: both are required until accepted, one at a time', async () => {
      let r = await G('/me/policies', a.accessToken);
      assert.equal(r.body.required, true); assert.equal(r.body.items.length, 2);
      r = await P('/me/policies/accept', { doc: 'privacy', version: '2026-12-a', lang: 'sw' }, a.accessToken); assert.equal(r.status, 200);
      assert.equal(r.body.required, true);
      assert.equal(r.body.items.find((i: any) => i.doc === 'privacy').accepted, true);
      r = await P('/me/policies/accept', { doc: 'terms', version: '2026-12-a', lang: 'sw' }, a.accessToken);
      assert.equal(r.body.required, false);
    });

    await ctx.test('another person is unaffected', async () => {
      assert.equal((await G('/me/policies', b.accessToken)).body.required, true);
    });

    await ctx.test('accepting twice changes nothing and is logged once', async () => {
      await P('/me/policies/accept', { doc: 'privacy', version: '2026-12-a', lang: 'en' }, a.accessToken);
      const rows = (await h.pool.query(`SELECT lang FROM governance.policy_acceptances WHERE user_id=$1 AND doc='privacy'`, [aId])).rows;
      assert.equal(rows.length, 1); assert.equal(rows[0].lang, 'sw');   // the first record stands
      const ev = (await h.pool.query(`SELECT metadata FROM governance.audit_events WHERE actor_id=$1 AND action='policy.accepted' ORDER BY id`, [aId])).rows;
      assert.equal(ev.length, 2); assert.deepEqual(ev[0].metadata, { doc: 'privacy', version: '2026-12-a' });
    });

    await ctx.test('a wrong version, document or language is refused', async () => {
      assert.equal((await P('/me/policies/accept', { doc: 'privacy', version: 'old', lang: 'en' }, b.accessToken)).status, 409);
      assert.equal((await P('/me/policies/accept', { doc: 'cookies', version: '2026-12-a', lang: 'en' }, b.accessToken)).status, 400);
      assert.equal((await P('/me/policies/accept', { doc: 'privacy', version: '2026-12-a', lang: 'fr' }, b.accessToken)).status, 400);
    });

    await ctx.test('a new version needs a new acceptance, and the old record stays', async () => {
      process.env.POLICY_PRIVACY_VERSION = '2027-01-b';
      const r = await G('/me/policies', a.accessToken);
      assert.equal(r.body.required, true);
      assert.equal(r.body.items.find((i: any) => i.doc === 'privacy').accepted, false);
      assert.equal(r.body.items.find((i: any) => i.doc === 'terms').accepted, true);
      assert.equal((await h.pool.query(`SELECT count(*)::int n FROM governance.policy_acceptances WHERE user_id=$1`, [aId])).rows[0].n, 2);
    });

    await ctx.test('the record cannot be edited or deleted, and it appears in the person\'s own export', async () => {
      await assert.rejects(h.pool.query(`UPDATE governance.policy_acceptances SET version='x' WHERE user_id=$1`, [aId]));
      await assert.rejects(h.pool.query(`DELETE FROM governance.policy_acceptances WHERE user_id=$1`, [aId]));
      const d = (await G('/me/data-export', a.accessToken)).body;
      assert.equal(d.policyAcceptances.length, 2);
    });

    await ctx.test('sign-in is never blocked by an unaccepted policy', async () => {
      const again = await h.login(b.p); assert.ok(again.accessToken);
    });
  } finally {
    for (const [k, v] of [['POLICY_PRIVACY_VERSION', saved.p], ['POLICY_TERMS_VERSION', saved.t]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await h.close();
  }
});
