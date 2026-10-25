import test from 'node:test';
import assert from 'node:assert/strict';
import { bootApp } from '../../../test-utils/http';

const t = process.env.DATABASE_URL ? test : test.skip;

t('apartment numbers and floors over HTTP: import, re-upload by cleaned address, manual edit', async (ctx) => {
  const h = await bootApp();
  try {
    const admin = await h.login();
    const org = (await h.call('POST', '/orgs', { name: 'Floor Managers', kind: 'management_firm' }, admin.accessToken)).body;
    const I = (p = '') => `/orgs/${org.id}/imports${p}`;
    const units = async (name: string) => {
      const list = (await h.call('GET', `/orgs/${org.id}/properties`, undefined, admin.accessToken)).body as any[];
      const p = list.find((x) => x.name === name);
      return p ? { p, units: (await h.call('GET', `/orgs/${org.id}/properties/${p.id}/units`, undefined, admin.accessToken)).body as any[] } : null;
    };
    let run: any;

    await ctx.test('apartment numbers are the names; floors are kept; a floor-only row is named by its floor', async () => {
      const text = ['Property,Address,Apartment No,Floor,Bedrooms',
        'Palm Court,Kodhek Rd,A1,1,2', 'Palm Court,Kodhek Rd,A2,1,2', 'Palm Court,Kodhek Rd,,2,1',
        'Rose Court,Waiyaki Way,,1,2', 'Rose Court,Waiyaki Way,,2,2'].join('\n');
      const r = await h.call('POST', I('/preview'), { csv: text }, admin.accessToken);
      assert.equal(r.body.counts.errors, 0); assert.equal(r.body.counts.warnings, 3); assert.equal(r.body.canCommit, true);
      assert.equal((await h.call('POST', I(`/${r.body.runId}/commit`), undefined, admin.accessToken)).status, 200);
      const palm = await units('Palm Court');
      assert.deepEqual(palm!.units.map((u) => [u.label, u.floor]).sort(), [['A1', '1'], ['A2', '1'], ['Floor 2', '2']]);
      assert.deepEqual((await units('Rose Court'))!.units.map((u) => [u.label, u.floor]), [['Floor 1', '1'], ['Floor 2', '2']]);
    });

    await ctx.test('a re-upload that puts the apartment in the address recognises the existing building and unit', async () => {
      const r = await h.call('POST', I('/preview'), { csv: 'Property,Address,Unit,Bedrooms\nPalm Court,"Kodhek Rd, Apt A1",,2\nPalm Court,Kodhek Rd,A3,2' }, admin.accessToken);
      run = r.body;
      assert.deepEqual([r.body.counts.newProperties, r.body.counts.existingProperties, r.body.counts.newUnits, r.body.counts.skippedUnits], [0, 1, 1, 1]);
      assert.equal((await h.call('POST', I(`/${run.runId}/commit`), undefined, admin.accessToken)).status, 200);
      assert.equal((await units('Palm Court'))!.units.length, 4);
    });

    await ctx.test('two units on one floor with no apartment numbers are refused with a clear hint', async () => {
      const r = await h.call('POST', I('/preview'), { csv: 'Property,Address,Floor,Bedrooms\nNew Place,Some Rd,1,2\nNew Place,Some Rd,1,2' }, admin.accessToken);
      assert.equal(r.body.canCommit, false); assert.ok(r.body.issues.some((i: any) => i.message.includes('Add apartment numbers')));
    });

    await ctx.test('manual units: floor can be set, changed and cleared; bad floors are refused', async () => {
      const palm = (await units('Palm Court'))!; const base = `/orgs/${org.id}/properties/${palm.p.id}/units`;
      const c = await h.call('POST', base, { label: 'C1', bedrooms: 1, floor: '3' }, admin.accessToken);
      assert.equal(c.status, 201); assert.equal(c.body.floor, '3');
      assert.equal((await h.call('PATCH', `${base}/${c.body.id}`, { floor: 'Ground' }, admin.accessToken)).body.floor, 'Ground');
      assert.equal((await h.call('PATCH', `${base}/${c.body.id}`, { floor: null }, admin.accessToken)).body.floor, null);
      assert.equal((await h.call('POST', base, { label: 'C2', bedrooms: 1, floor: 'x'.repeat(21) }, admin.accessToken)).status, 400);
    });
  } finally { await h.close(); }
});
