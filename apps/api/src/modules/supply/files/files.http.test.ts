import test from 'node:test';
import assert from 'node:assert/strict';
import { bootApp } from '../../../test-utils/http';

process.env.STORAGE_DRIVER = 'fake';
const t = process.env.DATABASE_URL ? test : test.skip;

const pdf = (n = 100) => Uint8Array.from(Buffer.from('%PDF-1.7\n' + 'x'.repeat(Math.max(0, n - 9))));
const jpg = (n = 200) => Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...new Array(n - 4).fill(1)]);
const png = (n = 100) => Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(n - 8).fill(2)]);

t('files over HTTP: upload flow, content checks, limits, isolation, roles, storage failures, audit', async (ctx) => {
  const h = await bootApp();
  try {
    const { STORAGE_PORT } = await import('./storage.port');
    const { FilesService } = await import('./files.service');
    const { AuditService } = await import('../../audit/audit.service');
    const fake: any = h.app.get(STORAGE_PORT);
    const admin = await h.login(), staff = await h.login(), outsider = await h.login(), tenant = await h.login();
    const orgA = (await h.call('POST', '/orgs', { name: 'Alpha Managers', kind: 'management_firm' }, admin.accessToken)).body;
    const orgB = (await h.call('POST', '/orgs', { name: 'Beta Agents', kind: 'agency' }, outsider.accessToken)).body;
    await h.pool.query(`INSERT INTO identity.memberships (user_id, org_id, role) VALUES ($1,$2,'manager_staff')`, [await h.userId(staff.p), orgA.id]);
    const propA = (await h.call('POST', `/orgs/${orgA.id}/properties`, { name: 'Palm Court', addressText: 'Argwings Kodhek Rd' }, admin.accessToken)).body;
    const propB = (await h.call('POST', `/orgs/${orgB.id}/properties`, { name: 'Beta Place', addressText: 'Other Rd' }, outsider.accessToken)).body;
    const unitA = (await h.call('POST', `/orgs/${orgA.id}/properties/${propA.id}/units`, { label: 'A1', bedrooms: 2 }, admin.accessToken)).body;
    const unitOther = (await h.call('POST', `/orgs/${orgB.id}/properties/${propB.id}/units`, { label: 'Z1', bedrooms: 1 }, outsider.accessToken)).body;
    const F = (org = orgA.id, prop = propA.id, p = '') => `/orgs/${org}/properties/${prop}/files${p}`;
    const pathOf = async (id: string) => (await h.pool.query('SELECT storage_path FROM supply.files WHERE id=$1', [id])).rows[0].storage_path as string;
    const statusOf = async (id: string) => (await h.pool.query('SELECT status, reject_reason FROM supply.files WHERE id=$1', [id])).rows[0];
    const request = (token: string, body: any, org = orgA.id, prop = propA.id) => h.call('POST', F(org, prop), body, token);
    const docReq = { kind: 'document', docType: 'title_deed', originalName: 'title deed.pdf', mimeType: 'application/pdf', sizeBytes: 100 };
    let doc: any, photo: any;

    await ctx.test('document types: any signed-in user can list the placeholder types; anonymous cannot', async () => {
      const r = await h.call('GET', '/document-types', undefined, tenant.accessToken);
      assert.equal(r.status, 200); assert.ok(r.body.some((x: any) => x.code === 'title_deed'));
      assert.equal((await h.call('GET', '/document-types')).status, 401);
    });

    await ctx.test('document: request, premature complete is refused, upload, complete, list, link, logged', async () => {
      const r = await request(admin.accessToken, docReq);
      assert.equal(r.status, 201); doc = r.body.file;
      assert.equal(r.body.upload.method, 'PUT'); assert.ok(r.body.upload.url.includes(await pathOf(doc.id)));
      assert.equal((await h.call('GET', F(), undefined, admin.accessToken)).body.length, 0, 'pending files are not listed');
      assert.equal((await h.call('POST', F(orgA.id, propA.id, `/${doc.id}/complete`), undefined, admin.accessToken)).status, 409, 'nothing uploaded yet');
      fake.put(await pathOf(doc.id), pdf(100));
      const done = await h.call('POST', F(orgA.id, propA.id, `/${doc.id}/complete`), undefined, admin.accessToken);
      assert.equal(done.status, 200); assert.equal(done.body.docType, 'title_deed');
      const list = await h.call('GET', F(), undefined, admin.accessToken);
      assert.equal(list.body.length, 1); assert.equal(list.body[0].originalName, 'title deed.pdf');
      const link = await h.call('GET', F(orgA.id, propA.id, `/${doc.id}/link`), undefined, staff.accessToken);
      assert.equal(link.status, 200); assert.equal(link.body.expiresInSec, 300); assert.ok(link.body.url.includes('name=title%20deed.pdf'), 'documents download under their name');
      const log = await h.pool.query(`SELECT count(*)::int n FROM governance.data_access_log WHERE resource='file:document' AND accessor_id=$1`, [await h.userId(staff.p)]);
      assert.equal(log.rows[0].n, 1, 'every link is written to the access log');
    });

    await ctx.test('photo on a unit; list filters by unit and by property level', async () => {
      const r = await request(staff.accessToken, { kind: 'photo', unitId: unitA.id, mimeType: 'image/jpeg', sizeBytes: 200 });
      assert.equal(r.status, 201); photo = r.body.file;
      fake.put(await pathOf(photo.id), jpg(200));
      assert.equal((await h.call('POST', F(orgA.id, propA.id, `/${photo.id}/complete`), undefined, staff.accessToken)).status, 200);
      const unitList = await h.call('GET', F(orgA.id, propA.id, `?unitId=${unitA.id}`), undefined, admin.accessToken);
      assert.deepEqual(unitList.body.map((x: any) => x.kind), ['photo']);
      const propLevel = await h.call('GET', F(orgA.id, propA.id, '?unitId=none'), undefined, admin.accessToken);
      assert.deepEqual(propLevel.body.map((x: any) => x.kind), ['document']);
      assert.equal((await h.call('GET', F(), undefined, admin.accessToken)).body.length, 2);
      assert.equal((await h.call('GET', F(orgA.id, propA.id, '?unitId=garbage'), undefined, admin.accessToken)).status, 400);
    });

    await ctx.test('validation: bad types, sizes, combinations and units are refused', async () => {
      const bad = (b: any) => request(admin.accessToken, b);
      assert.equal((await bad({ ...docReq, mimeType: 'text/html' })).status, 400);
      assert.equal((await bad({ ...docReq, mimeType: 'application/x-msdownload' })).status, 400);
      assert.equal((await bad({ ...docReq, sizeBytes: 11 * 1024 * 1024 })).status, 400);
      assert.equal((await bad({ ...docReq, docType: 'made_up' })).status, 400, 'unknown document type');
      assert.equal((await bad({ ...docReq, docType: undefined })).status, 400);
      assert.equal((await bad({ ...docReq, unitId: unitA.id })).status, 400, 'documents belong to the property');
      assert.equal((await bad({ kind: 'photo', docType: 'other', mimeType: 'image/jpeg', sizeBytes: 5 })).status, 400);
      assert.equal((await bad({ kind: 'photo', mimeType: 'video/mp4', sizeBytes: 5 })).status, 400, 'video type as a photo');
      assert.equal((await bad({ kind: 'script', mimeType: 'x', sizeBytes: 5 })).status, 400);
      assert.equal((await bad({ kind: 'photo', unitId: unitOther.id, mimeType: 'image/jpeg', sizeBytes: 5 })).status, 404, 'a unit from another organisation');
    });

    await ctx.test('content check: wrong content or wrong size is deleted and never listed', async () => {
      const a = (await request(admin.accessToken, docReq)).body.file;               // declared PDF, uploaded PNG
      fake.put(await pathOf(a.id), png(100));
      const r1 = await h.call('POST', F(orgA.id, propA.id, `/${a.id}/complete`), undefined, admin.accessToken);
      assert.equal(r1.status, 422); assert.deepEqual(await statusOf(a.id), { status: 'rejected', reject_reason: 'type_mismatch' });
      assert.equal(fake.objects.has(await pathOf(a.id)), false, 'the object was removed from storage');
      const b = (await request(admin.accessToken, docReq)).body.file;               // declared 100 bytes, uploaded 120
      fake.put(await pathOf(b.id), pdf(120));
      assert.equal((await h.call('POST', F(orgA.id, propA.id, `/${b.id}/complete`), undefined, admin.accessToken)).status, 422);
      assert.deepEqual(await statusOf(b.id), { status: 'rejected', reject_reason: 'size_mismatch' });
      const c = (await request(admin.accessToken, { ...docReq, mimeType: 'application/pdf' })).body.file;   // a program renamed .pdf
      fake.put(await pathOf(c.id), Uint8Array.from(Buffer.from('MZ\x90\x00 pretend program' + 'x'.repeat(80))).slice(0, 100));
      assert.equal((await h.call('POST', F(orgA.id, propA.id, `/${c.id}/complete`), undefined, admin.accessToken)).status, 422);
      assert.equal((await h.call('GET', F(), undefined, admin.accessToken)).body.length, 2, 'only the two good files are visible');
      assert.equal((await h.call('POST', F(orgA.id, propA.id, `/${a.id}/complete`), undefined, admin.accessToken)).status, 404, 'a rejected file cannot be completed again');
    });

    await ctx.test('limits: at most 3 videos per scope', async () => {
      for (let i = 0; i < 3; i++) assert.equal((await request(admin.accessToken, { kind: 'video', mimeType: 'video/mp4', sizeBytes: 1000 })).status, 201);
      assert.equal((await request(admin.accessToken, { kind: 'video', mimeType: 'video/mp4', sizeBytes: 1000 })).status, 409);
      assert.equal((await request(admin.accessToken, { kind: 'video', unitId: unitA.id, mimeType: 'video/mp4', sizeBytes: 1000 })).status, 201, 'the unit has its own allowance');
    });

    await ctx.test('isolation: another organisation cannot request, list, open, complete or delete, even with guessed ids', async () => {
      const A = (p = '') => F(orgA.id, propA.id, p), B = (p = '') => F(orgB.id, propA.id, p);   // second form: own org id, other org's property
      for (const [m, path, b] of [['GET', A(), undefined], ['POST', A(), docReq], ['GET', A(`/${doc.id}/link`), undefined], ['POST', A(`/${doc.id}/complete`), undefined], ['DELETE', A(`/${doc.id}`), undefined]] as const)
        assert.equal((await h.call(m, path, b, outsider.accessToken)).status, 403, `${m} ${path}`);
      for (const [m, path, b] of [['GET', B(), undefined], ['POST', B(), docReq], ['GET', B(`/${doc.id}/link`), undefined], ['POST', B(`/${doc.id}/complete`), undefined], ['DELETE', B(`/${doc.id}`), undefined]] as const)
        assert.equal((await h.call(m, path, b, outsider.accessToken)).status, 404, `${m} ${path}`);
      assert.equal((await h.call('GET', F(orgB.id, propB.id, `/${doc.id}/link`), undefined, outsider.accessToken)).status, 404, 'their own property but our file id');
      assert.equal((await h.call('GET', A(), undefined, tenant.accessToken)).status, 403);
      assert.equal((await h.call('GET', A())).status, 401);
    });

    await ctx.test('roles: staff cannot delete; admin can; deleted files disappear and their links stop working', async () => {
      assert.equal((await h.call('DELETE', F(orgA.id, propA.id, `/${photo.id}`), undefined, staff.accessToken)).status, 403);
      assert.equal((await h.call('DELETE', F(orgA.id, propA.id, `/${photo.id}`), undefined, admin.accessToken)).status, 204);
      assert.equal((await h.call('DELETE', F(orgA.id, propA.id, `/${photo.id}`), undefined, admin.accessToken)).status, 404);
      assert.equal((await h.call('GET', F(orgA.id, propA.id, `/${photo.id}/link`), undefined, admin.accessToken)).status, 404);
      assert.equal((await h.call('GET', F(), undefined, admin.accessToken)).body.length, 1);
    });

    await ctx.test('storage down: the request fails cleanly with 502 and leaves no usable file', async () => {
      const orig = fake.createSignedUpload; fake.createSignedUpload = async () => { throw new Error('boom'); };
      try {
        const r = await request(admin.accessToken, { kind: 'photo', mimeType: 'image/png', sizeBytes: 50 });
        assert.equal(r.status, 502);
        const rows = await h.pool.query(`SELECT status, reject_reason FROM supply.files WHERE mime_type='image/png' AND kind='photo' ORDER BY created_at DESC LIMIT 1`);
        assert.deepEqual(rows.rows[0], { status: 'rejected', reject_reason: 'storage_unavailable' });
      } finally { fake.createSignedUpload = orig; }
    });

    await ctx.test('storage not configured: file features switch off with 503; listing types still works', async () => {
      const off = new FilesService(h.pool as any, h.app.get(AuditService), null);
      await assert.rejects(() => off.requestUpload(orgA.id, propA.id, 'u', { kind: 'photo', mimeType: 'image/jpeg', sizeBytes: 5 }), (e: any) => e.getStatus() === 503);
      await assert.rejects(() => off.link(orgA.id, propA.id, doc.id, 'u'), (e: any) => e.getStatus() === 503);
      assert.ok((await off.documentTypes()).length >= 4);
    });

    await ctx.test('audit: uploads, rejections and deletions are recorded and the chain is intact', async () => {
      const a = await h.pool.query(`SELECT DISTINCT action FROM governance.audit_events WHERE action LIKE 'file.%'`);
      const got = a.rows.map((r: any) => r.action);
      for (const x of ['file.uploaded', 'file.rejected', 'file.deleted']) assert.ok(got.includes(x), x);
      const broken = await h.pool.query(`SELECT count(*)::int n FROM governance.audit_events a JOIN governance.audit_events b ON b.id=(SELECT max(id) FROM governance.audit_events WHERE id<a.id) WHERE a.prev_hash IS DISTINCT FROM b.hash`);
      assert.equal(broken.rows[0].n, 0);
    });
  } finally { await h.close(); }
});
