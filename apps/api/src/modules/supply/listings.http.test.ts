import test from 'node:test';
import assert from 'node:assert/strict';
import { bootApp } from '../../test-utils/http';

const t = process.env.DATABASE_URL ? test : test.skip;
const costs = { rent: 45000, deposit: 90000, utilityDeposit: 5000, serviceCharge: 3000, agentFee: 0 };

t('listings over HTTP: five-cost rule, one open listing per unit, confirm, let, withdraw, isolation, audit', async (ctx) => {
  const h = await bootApp();
  try {
    const admin = await h.login(), staff = await h.login(), outsider = await h.login(), tenant = await h.login();
    const orgA = (await h.call('POST', '/orgs', { name: 'Alpha Listings', kind: 'management_firm' }, admin.accessToken)).body;
    const orgB = (await h.call('POST', '/orgs', { name: 'Beta Listings', kind: 'agency' }, outsider.accessToken)).body;
    await h.pool.query(`INSERT INTO identity.memberships (user_id, org_id, role) VALUES ($1,$2,'manager_staff')`, [await h.userId(staff.p), orgA.id]);
    const prop = (await h.call('POST', `/orgs/${orgA.id}/properties`, { name: 'Lister Court', addressText: 'Some Road, Kilimani' }, admin.accessToken)).body;
    const mkUnit = async (label: string) => (await h.call('POST', `/orgs/${orgA.id}/properties/${prop.id}/units`, { label, bedrooms: 2 }, admin.accessToken)).body;
    const u1 = await mkUnit('A1'), u2 = await mkUnit('A2'), u3 = await mkUnit('A3');
    const L = (p = '') => `/orgs/${orgA.id}/listings${p}`;
    const create = (u: any, tok = admin.accessToken, body?: any) => h.call('POST', `/orgs/${orgA.id}/properties/${prop.id}/units/${u.id}/listings`, body, tok);
    let l: any;

    await ctx.test('create: a draft starts with no costs and no total', async () => {
      const r = await create(u1); assert.equal(r.status, 201); l = r.body;
      assert.equal(l.status, 'draft'); assert.equal(l.totalMoveIn, null); assert.equal(l.costs.rent, null);
      assert.equal(l.unitLabel, 'A1'); assert.equal(l.propertyName, 'Lister Court'); assert.equal(l.publishedAt, null);
    });

    await ctx.test('one open listing per unit: a second is refused', async () => {
      assert.equal((await create(u1)).status, 409);
    });

    await ctx.test('permissions: staff may write; tenant and outsider may not touch this organisation', async () => {
      assert.equal((await h.call('GET', L(), undefined, staff.accessToken)).status, 200);
      assert.equal((await h.call('GET', L(), undefined, tenant.accessToken)).status, 403);
      assert.equal((await h.call('GET', L(), undefined, outsider.accessToken)).status, 403);
      assert.equal((await create(u3, tenant.accessToken)).status, 403);
      assert.equal((await h.call('GET', L(), undefined)).status, 401);
    });

    await ctx.test('cost validation: refuses bad figures with clear messages', async () => {
      const put = (b: any) => h.call('PUT', L(`/${l.id}/costs`), b, admin.accessToken);
      for (const bad of [{ rent: -5 }, { rent: 0 }, { rent: 1.5 }, { rent: '45000' }, { deposit: null }, {}, { nonsense: 1 }]) assert.equal((await put(bad)).status, 400, JSON.stringify(bad));
      assert.equal((await h.call('PUT', L(`/${l.id}/costs`), undefined, admin.accessToken)).status, 400);
    });

    await ctx.test('publish is refused until all five costs exist, and says which are missing', async () => {
      assert.equal((await h.call('PUT', L(`/${l.id}/costs`), { rent: 45000, deposit: 90000 }, admin.accessToken)).status, 200);
      const r = await h.call('POST', L(`/${l.id}/publish`), undefined, admin.accessToken);
      assert.equal(r.status, 400); assert.match(r.body.message, /utilityDeposit/); assert.match(r.body.message, /agentFee/);
      assert.equal((await h.call('GET', L(`/${l.id}`), undefined, admin.accessToken)).body.status, 'draft');
    });

    await ctx.test('the database itself also refuses to publish without five costs (the API is not the only guard)', async () => {
      await assert.rejects(h.pool.query(`UPDATE supply.listings SET status='published', published_at=now(), last_confirmed_at=now() WHERE id=$1`, [l.id]), /cannot be published/);
    });

    await ctx.test('costs complete: total move-in is the sum; zero is accepted for agent fee', async () => {
      const r = await h.call('PUT', L(`/${l.id}/costs`), { utilityDeposit: 5000, serviceCharge: 3000, agentFee: 0 }, admin.accessToken);
      assert.equal(r.status, 200); assert.equal(r.body.totalMoveIn, 143000); assert.equal(r.body.costs.agentFee, 0); assert.equal(r.body.status, 'draft');
      const raw = (await h.pool.query(`SELECT amount_minor::text a FROM supply.listing_costs WHERE listing_id=$1 AND cost_type='rent'`, [l.id])).rows[0].a;
      assert.equal(raw, '4500000', 'stored as minor units (cents)');
    });

    await ctx.test('publish: goes live with both dates, reminder at 14 days and hiding at 21', async () => {
      const r = await h.call('POST', L(`/${l.id}/publish`), undefined, staff.accessToken);
      assert.equal(r.status, 201); assert.equal(r.body.status, 'published'); assert.ok(r.body.publishedAt && r.body.lastConfirmedAt);
      const days = (x: string) => Math.round((new Date(x).getTime() - new Date(r.body.lastConfirmedAt).getTime()) / 86400000);
      assert.equal(days(r.body.remindAt), 14); assert.equal(days(r.body.hideAt), 21);
      assert.equal((await h.call('POST', L(`/${l.id}/publish`), undefined, admin.accessToken)).status, 409, 'cannot publish twice');
    });

    await ctx.test('confirm: a stale listing comes back; a draft cannot be confirmed', async () => {
      await h.pool.query(`UPDATE supply.listings SET status='stale', last_confirmed_at = now() - interval '22 days' WHERE id=$1`, [l.id]);
      const r = await h.call('POST', L(`/${l.id}/confirm`), undefined, admin.accessToken);
      assert.equal(r.status, 201); assert.equal(r.body.status, 'published');
      assert.ok(Date.now() - new Date(r.body.lastConfirmedAt).getTime() < 60000);
      const d = (await create(u2)).body; assert.equal((await h.call('POST', L(`/${d.id}/confirm`), undefined, admin.accessToken)).status, 409);
    });

    await ctx.test('changing a cost on a live listing counts as confirming it', async () => {
      await h.pool.query(`UPDATE supply.listings SET last_confirmed_at = now() - interval '10 days' WHERE id=$1`, [l.id]);
      const r = await h.call('PUT', L(`/${l.id}/costs`), { rent: 47000 }, admin.accessToken);
      assert.equal(r.status, 200); assert.equal(r.body.totalMoveIn, 145000);
      assert.ok(Date.now() - new Date(r.body.lastConfirmedAt).getTime() < 60000);
    });

    await ctx.test('list: filters by status and property; shows unit and area details', async () => {
      assert.equal((await h.call('GET', L('?status=published'), undefined, admin.accessToken)).body.length, 1);
      assert.equal((await h.call('GET', L('?status=draft'), undefined, admin.accessToken)).body.length, 1);
      assert.equal((await h.call('GET', L(`?propertyId=${prop.id}`), undefined, admin.accessToken)).body.length, 2);
      assert.equal((await h.call('GET', L('?status=bogus'), undefined, admin.accessToken)).status, 400);
      assert.equal((await h.call('GET', L('?propertyId=zzz'), undefined, admin.accessToken)).status, 400);
    });

    await ctx.test('isolation: another organisation cannot reach these listings by guessing ids', async () => {
      const B = `/orgs/${orgB.id}`;
      assert.equal((await h.call('GET', `${B}/listings/${l.id}`, undefined, outsider.accessToken)).status, 404);
      assert.equal((await h.call('PUT', `${B}/listings/${l.id}/costs`, { rent: 1 }, outsider.accessToken)).status, 404);
      assert.equal((await h.call('POST', `${B}/listings/${l.id}/withdraw`, undefined, outsider.accessToken)).status, 404);
      assert.equal((await h.call('POST', `${B}/properties/${prop.id}/units/${u3.id}/listings`, undefined, outsider.accessToken)).status, 404);
      assert.equal((await h.call('GET', `${B}/listings`, undefined, outsider.accessToken)).body.length, 0);
    });

    await ctx.test('let: a let listing is final; the unit can then be offered again', async () => {
      const r = await h.call('POST', L(`/${l.id}/let`), undefined, admin.accessToken);
      assert.equal(r.status, 201); assert.equal(r.body.status, 'let');
      for (const a of ['publish', 'confirm', 'let', 'withdraw']) assert.equal((await h.call('POST', L(`/${l.id}/${a}`), undefined, admin.accessToken)).status, 409, a);
      assert.equal((await h.call('PUT', L(`/${l.id}/costs`), { rent: 1 }, admin.accessToken)).status, 409);
      assert.equal((await create(u1)).status, 201, 'a new listing for the same unit is allowed after it was let');
    });

    await ctx.test('create with costs in one go; withdraw a draft', async () => {
      const r = await create(u3, admin.accessToken, costs); assert.equal(r.status, 201); assert.equal(r.body.totalMoveIn, 143000);
      assert.equal((await h.call('POST', L(`/${r.body.id}/withdraw`), undefined, admin.accessToken)).body.status, 'withdrawn');
      assert.equal((await create(u3, admin.accessToken, { rent: 0 })).status, 400, 'bad costs at creation leave no draft behind');
      assert.equal((await h.pool.query(`SELECT count(*)::int n FROM supply.listings WHERE unit_id=$1 AND status='draft'`, [u3.id])).rows[0].n, 0);
    });

    await ctx.test('archiving a unit or a property takes its open listings off offer', async () => {
      const d = (await create(u3, admin.accessToken, costs)).body;
      await h.call('POST', L(`/${d.id}/publish`), undefined, admin.accessToken);
      assert.equal((await h.call('POST', `/orgs/${orgA.id}/properties/${prop.id}/units/${u3.id}/archive`, undefined, admin.accessToken)).status, 204);
      assert.equal((await h.pool.query(`SELECT status FROM supply.listings WHERE id=$1`, [d.id])).rows[0].status, 'withdrawn');
      assert.equal((await h.call('POST', `/orgs/${orgA.id}/properties/${prop.id}/archive`, undefined, admin.accessToken)).status, 204);
      const open = (await h.pool.query(`SELECT count(*)::int n FROM supply.listings l JOIN supply.units u ON u.id=l.unit_id WHERE u.property_id=$1 AND l.status IN ('draft','published','stale')`, [prop.id])).rows[0].n;
      assert.equal(open, 0);
    });

    await ctx.test('audit: every step is recorded and the chain still verifies', async () => {
      const ev = (await h.pool.query(`SELECT action, count(*)::int n FROM governance.audit_events WHERE subject_type='listing' AND metadata->>'orgId'=$1 GROUP BY action`, [orgA.id])).rows;
      const got = Object.fromEntries(ev.map((e: any) => [e.action, e.n]));
      for (const a of ['listing.created', 'listing.costs_set', 'listing.published', 'listing.confirmed', 'listing.let', 'listing.withdrawn']) assert.ok(got[a] >= 1, a);
      const chain = (await h.pool.query(`
        WITH e AS (SELECT id, prev_hash, hash, lag(hash) OVER (ORDER BY id) AS before FROM governance.audit_events)
        SELECT count(*) FILTER (WHERE id > (SELECT min(id) FROM e) AND prev_hash IS DISTINCT FROM before)::int broken FROM e`)).rows[0];
      assert.equal(chain.broken, 0, 'no broken links in the audit chain');
    });
  } finally { await h.close(); }
});
