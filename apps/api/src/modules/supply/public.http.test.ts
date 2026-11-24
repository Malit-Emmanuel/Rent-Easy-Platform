import test from 'node:test';
import assert from 'node:assert/strict';
import { bootApp } from '../../test-utils/http';

const t = process.env.DATABASE_URL ? test : test.skip;
const costs = { rent: 45000, deposit: 90000, utilityDeposit: 5000, serviceCharge: 3000, agentFee: 0 };

t('public search: switch, privacy of the data, freshness, filters, limits', async (ctx) => {
  const saved = { s: process.env.PUBLIC_SEARCH_ENABLED, r: process.env.PUBLIC_RATE_PER_10MIN };
  delete process.env.PUBLIC_SEARCH_ENABLED; process.env.PUBLIC_RATE_PER_10MIN = '100000';
  const h = await bootApp();
  try {
    const admin = await h.login();
    const org = (await h.call('POST', '/orgs', { name: 'Pub Managers', kind: 'management_firm' }, admin.accessToken)).body;
    const nodes = (await h.call('GET', '/nodes', undefined, admin.accessToken)).body;
    const node = nodes[0];
    const prop = (await h.call('POST', `/orgs/${org.id}/properties`, { name: 'Public Court', addressText: 'Secret Lane 7, Kilimani', nodeId: node.id, latitude: -1.29, longitude: 36.78 }, admin.accessToken)).body;
    const unit = async (label: string, bedrooms: number, c = costs, publish = true) => {
      const u = (await h.call('POST', `/orgs/${org.id}/properties/${prop.id}/units`, { label, bedrooms }, admin.accessToken)).body;
      const l = (await h.call('POST', `/orgs/${org.id}/properties/${prop.id}/units/${u.id}/listings`, c, admin.accessToken)).body;
      if (publish) await h.call('POST', `/orgs/${org.id}/listings/${l.id}/publish`, undefined, admin.accessToken);
      return { u, l };
    };
    const a = await unit('P1', 1, { ...costs, rent: 30000 }), b = await unit('P2', 2, { ...costs, rent: 50000, agentFee: 50000 }), draft = await unit('P3', 2, costs, false), old = await unit('P4', 3), letOne = await unit('P5', 3);
    await h.pool.query(`UPDATE supply.listings SET last_confirmed_at = now() - interval '22 days' WHERE id=$1`, [old.l.id]);   // stale but the job has not run yet
    await h.call('POST', `/orgs/${org.id}/listings/${letOne.l.id}/let`, undefined, admin.accessToken);
    const get = (p: string) => h.call('GET', `/public${p}`);
    // Public search is global and other tests run in parallel against the same database, so judge only the listings this test made.
    const ours = new Set([a.l.id, b.l.id, draft.l.id, old.l.id, letOne.l.id]);
    const mine = async (q = '') => (await get(`/listings${q}`)).body.items.filter((i: any) => ours.has(i.id));
    const mineIds = async (q = '') => (await mine(q)).map((i: any) => i.id);

    await ctx.test('switch off: every public route behaves as if it does not exist', async () => {
      for (const p of ['/listings', '/areas', `/listings/${a.l.id}`]) assert.equal((await get(p)).status, 404, p);
    });

    process.env.PUBLIC_SEARCH_ENABLED = 'true';

    await ctx.test('switch on: no sign-in needed; only live, fresh, complete listings appear', async () => {
      const r = await get('/listings?limit=50'); assert.equal(r.status, 200);
      assert.deepEqual((await mineIds('?limit=50')).sort(), [a.l.id, b.l.id].sort(), 'draft, stale (22 days), and let listings are not shown');
    });

    await ctx.test('privacy: nothing that identifies the organisation, the exact address, the map point or the unit', async () => {
      const r = { body: { items: await mine('?limit=50') } }; const raw = JSON.stringify(r.body);
      for (const bad of ['Secret Lane', 'orgId', 'org_id', 'latitude', 'longitude', 'addressText', 'location', 'unitId', '"P1"', 'P2', org.id, prop.id]) assert.ok(!raw.includes(bad), `${bad} must not appear`);
      const i = r.body.items.find((x: any) => x.id === a.l.id);
      assert.deepEqual(Object.keys(i).sort(), ['area', 'bedrooms', 'confirmedAt', 'costs', 'floor', 'id', 'nodeId', 'propertyName', 'totalMoveIn', 'verifiedUntil']);
      assert.equal(i.area, node.name); assert.equal(i.propertyName, 'Public Court');
    });

    await ctx.test('all five costs and the total to move in are shown', async () => {
      const i = (await mine('?limit=50')).find((x: any) => x.id === a.l.id);
      assert.deepEqual(i.costs, { rent: 30000, deposit: 90000, utilityDeposit: 5000, serviceCharge: 3000, agentFee: 0 });
      assert.equal(i.totalMoveIn, 128000);
    });

    await ctx.test('filters and sorting', async () => {
      assert.deepEqual(await mineIds('?bedrooms=2&limit=50'), [b.l.id]);
      assert.deepEqual(await mineIds('?maxRent=40000&limit=50'), [a.l.id]);
      assert.deepEqual(await mineIds('?minRent=40000&limit=50'), [b.l.id]);
      assert.equal((await mineIds(`?node=${node.id}&limit=50`)).length, 2);
      assert.equal((await get('/listings?node=999999')).body.items.length, 0);
      assert.equal((await mineIds('?verified=1&limit=50')).length, 0, 'no badge yet');
      assert.deepEqual(await mineIds('?sort=cost&limit=50'), [a.l.id, b.l.id], 'cheapest total move-in first');
      const page = await get('/listings?limit=1'); assert.equal(page.body.items.length, 1); assert.equal(page.body.hasMore, true);
      assert.equal((await get('/listings?limit=1&offset=1')).body.items.length, 1);
      for (const bad of ['?bedrooms=x', '?sort=random', '?limit=500', '?minRent=9&maxRent=1']) assert.equal((await get(`/listings${bad}`)).status, 400, bad);
    });

    await ctx.test('a valid property badge shows "documents checked", an expired or revoked one does not', async () => {
      const ins = async (expires: string, revoked: boolean) => (await h.pool.query(`INSERT INTO verification.badges (subject_type, subject_id, level, issued_at, expires_at, revoked_at, revoke_reason_code) VALUES ('property',$1,'t1_documented', now() - interval '2 years', ${expires}, ${revoked ? 'now()' : 'NULL'}, ${revoked ? "'test'" : 'NULL'}) RETURNING id`, [prop.id])).rows[0].id;
      const bad = await ins("now() + interval '1 year'", true); await ins("now() - interval '1 day'", false);
      assert.equal((await mineIds('?verified=1&limit=50')).length, 0);
      await ins("now() + interval '1 year'", false);
      const v = await mine('?verified=1&limit=50'); assert.equal(v.length, 2); assert.ok(v[0].verifiedUntil);
      void bad;
    });

    await ctx.test('detail and areas: a hidden listing is not found; areas count only what is shown', async () => {
      assert.equal((await get(`/listings/${a.l.id}`)).body.propertyName, 'Public Court');
      for (const hidden of [draft.l.id, old.l.id, letOne.l.id, '11111111-1111-4111-8111-111111111111']) assert.equal((await get(`/listings/${hidden}`)).status, 404);
      assert.equal((await get('/listings/not-an-id')).status, 400);
      const ar = await get('/areas'); assert.equal(ar.status, 200);
      assert.ok(ar.body.find((x: any) => x.id === node.id && x.name === node.name && x.listings >= 2), 'our area is listed with at least our two listings');
    });

    await ctx.test('archiving the property takes its listings off search at once', async () => {
      await h.call('POST', `/orgs/${org.id}/properties/${prop.id}/archive`, undefined, admin.accessToken);
      assert.equal((await mineIds('?limit=50')).length, 0);
    });

    await ctx.test('request limit per address: too many requests get 429 and the limit can be tuned', async () => {
      process.env.PUBLIC_RATE_PER_10MIN = '3';
      const codes = []; for (let i = 0; i < 5; i++) codes.push((await get('/areas')).status);
      assert.deepEqual(codes, [200, 200, 200, 429, 429]);
    });

    await ctx.test('public routes need no sign-in but private ones still do', async () => {
      process.env.PUBLIC_RATE_PER_10MIN = '100000';
      assert.equal((await h.call('GET', `/orgs/${org.id}/listings`)).status, 401);
      assert.equal((await h.call('GET', '/public/areas')).status, 200);
    });
  } finally {
    if (saved.s === undefined) delete process.env.PUBLIC_SEARCH_ENABLED; else process.env.PUBLIC_SEARCH_ENABLED = saved.s;
    if (saved.r === undefined) delete process.env.PUBLIC_RATE_PER_10MIN; else process.env.PUBLIC_RATE_PER_10MIN = saved.r;
    await h.close();
  }
});
