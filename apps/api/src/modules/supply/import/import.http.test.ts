import test from 'node:test';
import assert from 'node:assert/strict';
import { bootApp } from '../../../test-utils/http';

const t = process.env.DATABASE_URL ? test : test.skip;
const csv = (...lines: string[]) => lines.join('\n');
const HEAD = 'Property,Address,Area,Unit,Bedrooms,Latitude,Longitude';

t('bulk import over HTTP: dry run, confirm, re-uploads, errors, isolation, expiry, limits, atomicity', async (ctx) => {
  const h = await bootApp();
  try {
    const admin = await h.login(), staff = await h.login(), outsider = await h.login(), tenant = await h.login();
    const orgA = (await h.call('POST', '/orgs', { name: 'Alpha Managers', kind: 'management_firm' }, admin.accessToken)).body;
    const orgB = (await h.call('POST', '/orgs', { name: 'Beta Agents', kind: 'agency' }, outsider.accessToken)).body;
    await h.pool.query(`INSERT INTO identity.memberships (user_id, org_id, role) VALUES ($1,$2,'manager_staff')`, [await h.userId(staff.p), orgA.id]);
    const I = (p = '', org = orgA.id) => `/orgs/${org}/imports${p}`;
    const preview = (token: string, text: string, org = orgA.id, fileName = 'units.csv') => h.call('POST', I('/preview', org), { fileName, csv: text }, token);
    const props = async (org = orgA.id) => (await h.call('GET', `/orgs/${org}/properties`, undefined, admin.accessToken)).body as any[];
    const dbCount = async (sql: string, args: unknown[] = []) => (await h.pool.query(sql, args)).rows[0].n as number;
    let first: any;

    const clean = csv(HEAD,
      'Palm Court,Argwings Kodhek Rd,Kilimani,A1,2,-1.2921,36.7872', 'Palm Court,Argwings Kodhek Rd,Kilimani,A2,2,-1.2921,36.7872', 'Palm Court,Argwings Kodhek Rd,Kilimani,B1,Bedsitter,-1.2921,36.7872',
      'Sample Heights,Sample Lane Westlands,Westlands,1,1,,', 'Sample Heights,Sample Lane Westlands,Westlands,2,3 BR,,');

    await ctx.test('dry run: shows what would happen and creates nothing', async () => {
      const r = await preview(admin.accessToken, clean);
      assert.equal(r.status, 200); first = r.body;
      assert.deepEqual([first.counts.newProperties, first.counts.newUnits, first.counts.errors, first.counts.existingProperties], [2, 5, 0, 0]);
      assert.equal(first.canCommit, true); assert.equal(first.status, 'planned'); assert.equal(first.headerMap.Property, 'property');
      assert.equal((await props()).length, 0, 'nothing is created by a dry run');
    });

    await ctx.test('confirm: creates the properties and units, with area, position and a link back to the import', async () => {
      const c = await h.call('POST', I(`/${first.runId}/commit`), { plan: { properties: [{ name: 'EVIL', units: [] }] } }, staff.accessToken);   // staff may confirm; body is ignored
      assert.equal(c.status, 200); assert.deepEqual([c.body.propertiesCreated, c.body.unitsCreated, c.body.unitsSkipped], [2, 5, 0]);
      const list = await props(); assert.deepEqual(list.map((p) => p.name).sort(), ['Palm Court', 'Sample Heights']); assert.ok(!list.some((p) => p.name === 'EVIL'));
      const palm = list.find((p) => p.name === 'Palm Court'); assert.equal(palm.nodeName, 'Kilimani'); assert.equal(palm.unitCount, 3);
      assert.ok(Math.abs(palm.latitude - -1.2921) < 1e-6 && Math.abs(palm.longitude - 36.7872) < 1e-6);
      const units = (await h.call('GET', `/orgs/${orgA.id}/properties/${palm.id}/units`, undefined, admin.accessToken)).body;
      assert.deepEqual(units.map((u: any) => [u.label, u.bedrooms]), [['A1', 2], ['A2', 2], ['B1', 0]]);
      assert.equal(await dbCount(`SELECT count(*)::int n FROM supply.units WHERE import_run_id=$1`, [first.runId]), 5);
      assert.equal(await dbCount(`SELECT count(*)::int n FROM supply.properties WHERE import_run_id=$1`, [first.runId]), 2);
      const done = await h.call('GET', I(`/${first.runId}`), undefined, admin.accessToken);
      assert.equal(done.body.status, 'committed'); assert.deepEqual(done.body.result, c.body && { propertiesCreated: 2, propertiesReused: 0, unitsCreated: 5, unitsSkipped: 0 });
    });

    await ctx.test('confirming twice is refused, and nothing is duplicated', async () => {
      assert.equal((await h.call('POST', I(`/${first.runId}/commit`), undefined, admin.accessToken)).status, 409);
      assert.equal((await props()).length, 2);
    });

    await ctx.test('uploading the same file again: everything exists, nothing to import', async () => {
      const r = await preview(admin.accessToken, clean);
      assert.deepEqual([r.body.counts.newProperties, r.body.counts.newUnits, r.body.counts.existingProperties, r.body.counts.skippedUnits], [0, 0, 2, 5]);
      assert.equal(r.body.canCommit, false); assert.equal(r.body.nothingToImport, true);
      assert.equal(r.body.issues.filter((i: any) => i.code === 'unit_exists').length, 5);
      assert.equal((await h.call('POST', I(`/${r.body.runId}/commit`), undefined, admin.accessToken)).status, 409);
    });

    await ctx.test('mixed file: existing building reused, existing unit skipped, new units and a new building created', async () => {
      const mixed = csv(HEAD, 'palm  COURT,Argwings Kodhek Rd,Kilimani,A1,2,,', 'Palm Court,Argwings Kodhek Rd,Kilimani,C1,1,,', 'Palm Court,Argwings Kodhek Rd,Kilimani,C2,1,,', 'Café Court,Rue Élysée Road,Kileleshwa,1,2,,');
      const r = await preview(admin.accessToken, mixed);
      assert.deepEqual([r.body.counts.newProperties, r.body.counts.existingProperties, r.body.counts.newUnits, r.body.counts.skippedUnits], [1, 1, 3, 1]);
      const c = await h.call('POST', I(`/${r.body.runId}/commit`), undefined, admin.accessToken);
      assert.deepEqual([c.body.propertiesCreated, c.body.propertiesReused, c.body.unitsCreated, c.body.unitsSkipped], [1, 1, 3, 0 + 1]);
      const list = await props(); assert.equal(list.length, 3);
      assert.equal(list.find((p) => p.name === 'Palm Court').unitCount, 5);
      assert.ok(list.some((p) => p.name === 'Café Court'), 'accented names work');
    });

    await ctx.test('errors: every problem is reported with its row, and the import cannot be confirmed', async () => {
      const bad = csv(HEAD, 'Good Place,Valid Address Road,Kilimani,G1,1,,', ',Valid Address Road,Kilimani,G2,1,,', 'Good Place,Valid Address Road,Kilimani,G3,many,,', 'Good Place,Valid Address Road,Kilimani,G1,2,,', 'Good Place,Valid Address Road,Kilimani,G4,1,36.8,-1.29');
      const r = await preview(admin.accessToken, bad);
      assert.equal(r.body.canCommit, false); assert.equal(r.body.counts.errors, 4);
      assert.deepEqual(r.body.issues.filter((i: any) => i.severity === 'error').map((i: any) => i.row), [3, 4, 5, 6]);
      assert.equal((await h.call('POST', I(`/${r.body.runId}/commit`), undefined, admin.accessToken)).status, 409);
      assert.ok(!(await props()).some((p) => p.name === 'Good Place'), 'nothing from a file with errors is created');
    });

    await ctx.test('a file missing a required column gets one clear message', async () => {
      const r = await preview(admin.accessToken, csv('Property,Unit,Bedrooms', 'Palm Court,A1,2'));
      assert.equal(r.body.counts.errors, 1); assert.equal(r.body.issues[0].code, 'missing_column'); assert.equal(r.body.canCommit, false);
    });

    await ctx.test('500 units: a messy sheet reports exactly its defects; the clean sheet imports in seconds', async () => {
      const mk = (defects: boolean) => { const lines = [HEAD]; for (let i = 0; i < 500; i++) lines.push(`Estate ${String.fromCharCode(65 + (i % 20))},Road ${i % 20} Nairobi,Westlands,N${i},${defects && i % 50 === 7 ? 'lots' : ['1', '2 BR', 'bedsitter', 'Two bedroom', '3'][i % 5]},,`); return csv(...lines); };
      const messy = await preview(admin.accessToken, mk(true));
      assert.equal(messy.body.counts.errors, 10); assert.equal(messy.body.canCommit, false);
      const r = await preview(admin.accessToken, mk(false));
      assert.deepEqual([r.body.counts.newProperties, r.body.counts.newUnits], [20, 500]);
      const t0 = Date.now(); const c = await h.call('POST', I(`/${r.body.runId}/commit`), undefined, admin.accessToken); const ms = Date.now() - t0;
      assert.deepEqual([c.body.propertiesCreated, c.body.unitsCreated], [20, 500]); assert.ok(ms < 10_000, `commit took ${ms} ms`);
      console.log(`      (500-unit commit took ${ms} ms)`);
    });

    await ctx.test('isolation and roles: other organisations, other runs, tenants and anonymous callers are refused', async () => {
      const r = await preview(admin.accessToken, csv(HEAD, 'Iso Place,Iso Address Road,Kilimani,1,1,,'));
      assert.equal((await preview(outsider.accessToken, 'x', orgA.id)).status, 403);
      assert.equal((await h.call('GET', I('', orgA.id), undefined, outsider.accessToken)).status, 403);
      assert.equal((await h.call('POST', I(`/${r.body.runId}/commit`, orgA.id), undefined, outsider.accessToken)).status, 403);
      assert.equal((await h.call('GET', I(`/${r.body.runId}`, orgB.id), undefined, outsider.accessToken)).status, 404, 'own org id, other org run id');
      assert.equal((await h.call('POST', I(`/${r.body.runId}/commit`, orgB.id), undefined, outsider.accessToken)).status, 404);
      assert.equal((await preview(tenant.accessToken, 'x')).status, 403);
      assert.equal((await h.call('POST', I('/preview'), { csv: 'x' })).status, 401);
      assert.equal((await h.call('GET', `/orgs/${orgB.id}/properties`, undefined, outsider.accessToken)).body.length, 0, 'the other organisation gained nothing');
      assert.equal((await h.call('GET', I(), undefined, staff.accessToken)).status, 200);
    });

    await ctx.test('expiry: an old preview cannot be confirmed', async () => {
      const r = await preview(admin.accessToken, csv(HEAD, 'Old Place,Old Address Road,Kilimani,1,1,,'));
      await h.pool.query(`UPDATE supply.import_runs SET created_at = now() - interval '25 hours' WHERE id=$1`, [r.body.runId]);
      const c = await h.call('POST', I(`/${r.body.runId}/commit`), undefined, admin.accessToken);
      assert.equal(c.status, 409); assert.match(c.body.message, /expired/);
    });

    await ctx.test('size limits: over 2 MB is refused with a message; over the request limit is refused outright', async () => {
      const big = HEAD + '\n' + 'Big Place,Big Address Road,Kilimani,' + 'x'.repeat(2.2 * 1024 * 1024) + ',1,,';
      const r = await preview(admin.accessToken, big);
      assert.equal(r.status, 200); assert.equal(r.body.canCommit, false); assert.match(r.body.issues[0].message, /2 MB/);
      assert.equal((await h.call('POST', I('/preview'), { csv: 'y'.repeat(4 * 1024 * 1024) }, admin.accessToken)).status, 413);
      assert.equal((await preview(admin.accessToken, '')).status, 400);
    });

    await ctx.test('atomic: if the import fails halfway, nothing at all is saved and the preview stays usable', async () => {
      await h.pool.query(`CREATE OR REPLACE FUNCTION supply.test_boom() RETURNS trigger AS $$ BEGIN IF NEW.label = 'BOOM' THEN RAISE EXCEPTION 'boom'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
      await h.pool.query(`CREATE TRIGGER test_boom_trg BEFORE INSERT ON supply.units FOR EACH ROW EXECUTE FUNCTION supply.test_boom()`);
      try {
        const r = await preview(admin.accessToken, csv(HEAD, 'Atomic Place,Atomic Address Road,Kilimani,OK1,1,,', 'Atomic Place,Atomic Address Road,Kilimani,BOOM,1,,'));
        assert.equal(r.body.canCommit, true);
        const c = await h.call('POST', I(`/${r.body.runId}/commit`), undefined, admin.accessToken);
        assert.equal(c.status, 500);
        assert.ok(!(await props()).some((p) => p.name === 'Atomic Place'), 'the property was rolled back too');
        assert.equal(await dbCount(`SELECT count(*)::int n FROM supply.units WHERE label IN ('OK1','BOOM')`), 0);
        assert.equal((await h.call('GET', I(`/${r.body.runId}`), undefined, admin.accessToken)).body.status, 'planned');
      } finally { await h.pool.query('DROP TRIGGER IF EXISTS test_boom_trg ON supply.units'); await h.pool.query('DROP FUNCTION IF EXISTS supply.test_boom()'); }
    });

    await ctx.test('rate limit: the 31st preview within an hour is refused', async () => {
      const n = await dbCount(`SELECT count(*)::int n FROM supply.import_runs WHERE org_id=$1 AND created_at > now() - interval '1 hour'`, [orgA.id]);
      for (let i = n; i < 30; i++) await h.pool.query(`INSERT INTO supply.import_runs (org_id, created_by, content_sha256, row_count, error_count, warning_count, plan, issues) VALUES ($1,$2,'x',0,0,0,'{}','[]')`, [orgA.id, await h.userId(admin.p)]);
      assert.equal((await preview(admin.accessToken, csv(HEAD, 'Rate Place,Rate Address Road,Kilimani,1,1,,'))).status, 429);
    });

    await ctx.test('audit: previews and confirmations are recorded and the chain is intact', async () => {
      const a = (await h.pool.query(`SELECT DISTINCT action FROM governance.audit_events WHERE action LIKE 'import.%'`)).rows.map((r: any) => r.action);
      assert.ok(a.includes('import.previewed') && a.includes('import.committed'));
      assert.equal(await dbCount(`SELECT count(*)::int n FROM governance.audit_events a JOIN governance.audit_events b ON b.id=(SELECT max(id) FROM governance.audit_events WHERE id<a.id) WHERE a.prev_hash IS DISTINCT FROM b.hash`), 0);
    });
  } finally { await h.close(); }
});
