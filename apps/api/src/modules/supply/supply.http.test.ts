import test from 'node:test';
import assert from 'node:assert/strict';
import { bootApp } from '../../test-utils/http';

const t = process.env.DATABASE_URL ? test : test.skip;

t('properties and units over HTTP: permissions, validation, isolation, archiving, audit', async (ctx) => {
  const h = await bootApp();
  try {
    const admin = await h.login(), staff = await h.login(), outsider = await h.login(), tenant = await h.login();
    const orgA = (await h.call('POST', '/orgs', { name: 'Alpha Managers', kind: 'management_firm' }, admin.accessToken)).body;
    const orgB = (await h.call('POST', '/orgs', { name: 'Beta Agents', kind: 'agency' }, outsider.accessToken)).body;
    await h.pool.query(`INSERT INTO identity.memberships (user_id, org_id, role) VALUES ($1,$2,'manager_staff')`, [await h.userId(staff.p), orgA.id]);
    const A = (p = '') => `/orgs/${orgA.id}/properties${p}`;
    const body = { name: 'Palm Court', addressText: 'Argwings Kodhek Road, Kilimani', latitude: -1.2921, longitude: 36.7872 };
    let nodeId = 0; let prop: any; let unit: any;

    await ctx.test('nodes: any signed-in user can list placeholder nodes; anonymous cannot', async () => {
      const r = await h.call('GET', '/nodes', undefined, tenant.accessToken);
      assert.equal(r.status, 200); assert.ok(r.body.length >= 4); nodeId = r.body[0].id;
      assert.equal((await h.call('GET', '/nodes')).status, 401);
    });

    await ctx.test('create: admin creates a property with node and position', async () => {
      const r = await h.call('POST', A(), { ...body, nodeId }, admin.accessToken);
      assert.equal(r.status, 201); prop = r.body;
      assert.equal(prop.name, 'Palm Court'); assert.equal(prop.unitCount, 0); assert.equal(prop.nodeId, nodeId);
      assert.ok(Math.abs(prop.latitude - -1.2921) < 1e-6 && Math.abs(prop.longitude - 36.7872) < 1e-6, 'position round-trips with latitude and longitude in the right order');
    });

    await ctx.test('validation: bad input is refused with clear messages', async () => {
      assert.equal((await h.call('POST', A(), { addressText: 'somewhere' }, admin.accessToken)).status, 400);
      const swapped = await h.call('POST', A(), { name: 'X Court', addressText: 'Road', latitude: 36.8, longitude: -1.29 }, admin.accessToken);
      assert.equal(swapped.status, 400); assert.match(swapped.body.message, /swapped/);
      assert.equal((await h.call('POST', A(), { name: 'Y Court', addressText: 'Road', latitude: 51.5, longitude: -0.12 }, admin.accessToken)).status, 400);
      assert.equal((await h.call('POST', A(), { name: 'Z Court', addressText: 'Road', nodeId: 999999 }, admin.accessToken)).status, 400);
      assert.equal((await h.call('POST', A(), { name: 'Z Court', addressText: 'Road', latitude: -1.3 }, admin.accessToken)).status, 400, 'one-sided position');
      assert.equal((await h.call('GET', `/orgs/not-a-uuid/properties`, undefined, admin.accessToken)).status, 403, 'a nonsense organisation id is refused by the permission check first');
      assert.equal((await h.call('GET', A('/not-a-uuid'), undefined, admin.accessToken)).status, 400, 'a malformed property id is a bad request');
    });

    await ctx.test('duplicates: the same building (any letter case) is refused', async () => {
      const r = await h.call('POST', A(), { name: 'palm court', addressText: 'ARGWINGS KODHEK ROAD, KILIMANI' }, admin.accessToken);
      assert.equal(r.status, 409);
    });

    await ctx.test('read: list, get, and the limit parameter', async () => {
      await h.call('POST', A(), { name: 'Second Place', addressText: 'Another road' }, admin.accessToken);
      const l = await h.call('GET', A(), undefined, admin.accessToken);
      assert.equal(l.status, 200); assert.equal(l.body.length, 2); assert.equal(l.body[0].name, 'Palm Court');
      assert.equal((await h.call('GET', A('?limit=1'), undefined, admin.accessToken)).body.length, 1);
      assert.equal((await h.call('GET', A(`/${prop.id}`), undefined, admin.accessToken)).body.id, prop.id);
    });

    await ctx.test('update: change fields, clear the position, refuse empty updates', async () => {
      const r = await h.call('PATCH', A(`/${prop.id}`), { name: 'Palm Court Annex' }, admin.accessToken);
      assert.equal(r.status, 200); assert.equal(r.body.name, 'Palm Court Annex'); assert.ok(r.body.latitude !== null);
      const c = await h.call('PATCH', A(`/${prop.id}`), { latitude: null, longitude: null, nodeId: null }, admin.accessToken);
      assert.equal(c.body.latitude, null); assert.equal(c.body.nodeId, null);
      assert.equal((await h.call('PATCH', A(`/${prop.id}`), {}, admin.accessToken)).status, 400);
    });

    await ctx.test('roles: staff can create and edit but not archive; a person with no organisation is refused', async () => {
      const made = await h.call('POST', A(), { name: 'Staff Added', addressText: 'Staff road' }, staff.accessToken);
      assert.equal(made.status, 201);
      assert.equal((await h.call('PATCH', A(`/${made.body.id}`), { name: 'Staff Edited' }, staff.accessToken)).status, 200);
      assert.equal((await h.call('POST', A(`/${made.body.id}/archive`), undefined, staff.accessToken)).status, 403);
      assert.equal((await h.call('POST', A(`/${made.body.id}/archive`), undefined, admin.accessToken)).status, 204);
      assert.equal((await h.call('GET', A(), undefined, tenant.accessToken)).status, 403);
      assert.equal((await h.call('POST', A(), body, tenant.accessToken)).status, 403);
      assert.equal((await h.call('GET', A())).status, 401);
    });

    await ctx.test('isolation: another organisation cannot read or change anything, even by guessing ids', async () => {
      const B = (p = '') => `/orgs/${orgB.id}/properties${p}`;
      // Using the owner's organisation id in the URL: not a member
      for (const [m, path, b] of [['GET', A(), undefined], ['GET', A(`/${prop.id}`), undefined], ['POST', A(), body], ['PATCH', A(`/${prop.id}`), { name: 'Hacked' }],
        ['POST', A(`/${prop.id}/archive`), undefined], ['GET', A(`/${prop.id}/units`), undefined]] as const)
        assert.equal((await h.call(m, path, b, outsider.accessToken)).status, 403, `${m} ${path}`);
      // Using their OWN organisation id but the other organisation's property id (the sneaky attempt)
      for (const [m, path, b] of [['GET', B(`/${prop.id}`), undefined], ['PATCH', B(`/${prop.id}`), { name: 'Hacked' }], ['POST', B(`/${prop.id}/archive`), undefined],
        ['GET', B(`/${prop.id}/units`), undefined], ['POST', B(`/${prop.id}/units`), { label: 'Z1', bedrooms: 1 }]] as const)
        assert.equal((await h.call(m, path, b, outsider.accessToken)).status, 404, `${m} ${path}`);
      assert.equal((await h.call('GET', B(), undefined, outsider.accessToken)).body.length, 0, 'their own list is empty');
      assert.equal((await h.call('GET', A(`/${prop.id}`), undefined, admin.accessToken)).body.name, 'Palm Court Annex', 'owner data unchanged');
    });

    await ctx.test('units: create, duplicate labels, validation, edit, list', async () => {
      const u = await h.call('POST', A(`/${prop.id}/units`), { label: ' A1 ', bedrooms: 2 }, admin.accessToken);
      assert.equal(u.status, 201); unit = u.body; assert.equal(unit.label, 'A1');
      assert.equal((await h.call('POST', A(`/${prop.id}/units`), { label: 'a1', bedrooms: 1 }, staff.accessToken)).status, 409, 'label clash ignores letter case');
      assert.equal((await h.call('POST', A(`/${prop.id}/units`), { label: 'B1', bedrooms: -1 }, admin.accessToken)).status, 400);
      assert.equal((await h.call('POST', A(`/${prop.id}/units`), { label: 'B1', bedrooms: 0 }, staff.accessToken)).status, 201, 'a bedsitter has 0 bedrooms');
      const e = await h.call('PATCH', A(`/${prop.id}/units/${unit.id}`), { bedrooms: 3 }, admin.accessToken);
      assert.equal(e.body.bedrooms, 3);
      const l = await h.call('GET', A(`/${prop.id}/units`), undefined, admin.accessToken);
      assert.deepEqual(l.body.map((x: any) => x.label), ['A1', 'B1']);
      assert.equal((await h.call('GET', A(`/${prop.id}`), undefined, admin.accessToken)).body.unitCount, 2);
    });

    await ctx.test('units: archive hides the unit and frees the label; staff cannot archive', async () => {
      assert.equal((await h.call('POST', A(`/${prop.id}/units/${unit.id}/archive`), undefined, staff.accessToken)).status, 403);
      assert.equal((await h.call('POST', A(`/${prop.id}/units/${unit.id}/archive`), undefined, admin.accessToken)).status, 204);
      assert.equal((await h.call('POST', A(`/${prop.id}/units/${unit.id}/archive`), undefined, admin.accessToken)).status, 404, 'already archived');
      assert.equal((await h.call('POST', A(`/${prop.id}/units`), { label: 'A1', bedrooms: 1 }, admin.accessToken)).status, 201, 'label reusable');
    });

    await ctx.test('archiving a property archives its units; the building can be added again; nothing is deleted', async () => {
      assert.equal((await h.call('POST', A(`/${prop.id}/archive`), undefined, admin.accessToken)).status, 204);
      assert.equal((await h.call('GET', A(`/${prop.id}`), undefined, admin.accessToken)).status, 404);
      assert.equal((await h.call('GET', A(`/${prop.id}/units`), undefined, admin.accessToken)).status, 404);
      const left = await h.pool.query(`SELECT count(*)::int n FROM supply.units WHERE property_id=$1 AND archived_at IS NULL`, [prop.id]);
      assert.equal(left.rows[0].n, 0);
      const kept = await h.pool.query(`SELECT count(*)::int n FROM supply.units WHERE property_id=$1`, [prop.id]);
      assert.ok(kept.rows[0].n >= 3, 'units still exist in the database');
      assert.equal((await h.call('POST', A(), { name: 'Palm Court Annex', addressText: 'Argwings Kodhek Road, Kilimani' }, admin.accessToken)).status, 201);
    });

    await ctx.test('audit: every change is recorded and the chain is intact', async () => {
      const a = await h.pool.query(`SELECT DISTINCT action FROM governance.audit_events WHERE action LIKE 'property.%' OR action LIKE 'unit.%'`);
      const got = a.rows.map((r: any) => r.action).sort();
      for (const x of ['property.created', 'property.updated', 'property.archived', 'unit.created', 'unit.updated', 'unit.archived']) assert.ok(got.includes(x), x);
      const broken = await h.pool.query(`SELECT count(*)::int n FROM governance.audit_events a JOIN governance.audit_events b ON b.id=(SELECT max(id) FROM governance.audit_events WHERE id<a.id) WHERE a.prev_hash IS DISTINCT FROM b.hash`);
      assert.equal(broken.rows[0].n, 0);
    });
  } finally { await h.close(); }
});
