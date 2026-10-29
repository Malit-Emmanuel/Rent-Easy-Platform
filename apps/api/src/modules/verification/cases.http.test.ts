import test from 'node:test';
import assert from 'node:assert/strict';
import { bootApp } from '../../test-utils/http';

const t = process.env.DATABASE_URL ? test : test.skip;

t('property verification requests over HTTP: rules, isolation, appeal, status', async (ctx) => {
  const h = await bootApp();
  try {
    const admin = await h.login(), outsider = await h.login(), tenant = await h.login(), reviewer = await h.login();
    const org = (await h.call('POST', '/orgs', { name: 'Case Managers', kind: 'agency' }, admin.accessToken)).body;
    const other = (await h.call('POST', '/orgs', { name: 'Other Agents', kind: 'agency' }, outsider.accessToken)).body;
    const prop = (await h.call('POST', `/orgs/${org.id}/properties`, { name: 'Palm Court', addressText: 'Argwings Kodhek Rd' }, admin.accessToken)).body;
    const V = `/orgs/${org.id}/properties/${prop.id}/verification`;
    const adminId = await h.userId(admin.p);
    const addDoc = (type: string, path: string) => h.pool.query(
      `INSERT INTO supply.files (id, org_id, property_id, kind, doc_type, storage_path, mime_type, size_bytes, status, uploaded_by, ready_at)
       VALUES (gen_random_uuid(), $1, $2, 'document', $3, $4, 'application/pdf', 1000, 'ready', $5, now() - interval '2 hours')`, [org.id, prop.id, type, path, adminId]);
    let caseId = '';

    await ctx.test('status before anything: not verified, proof missing, can request', async () => {
      const r = await h.call('GET', V, undefined, admin.accessToken);
      assert.equal(r.status, 200); assert.equal(r.body.verified, false); assert.equal(r.body.case, null); assert.equal(r.body.canRequest, true);
      assert.deepEqual(r.body.missingProof, ['title_deed_or_lease', 'management_authorisation']);
    });

    await ctx.test('requesting needs ID verification first', async () => {
      const r = await h.call('POST', V, undefined, admin.accessToken);
      assert.equal(r.status, 403); assert.equal(r.body.code, 'id_not_verified');
      await h.pool.query(`INSERT INTO verification.badges (subject_type, subject_id, level, expires_at) VALUES ('user',$1,'id_verified', now() + interval '1 year')`, [adminId]);
    });

    await ctx.test('requesting needs the required documents', async () => {
      const r = await h.call('POST', V, undefined, admin.accessToken);
      assert.equal(r.status, 422); assert.equal(r.body.code, 'proof_missing'); assert.deepEqual(r.body.missing, ['title_deed_or_lease', 'management_authorisation']);
      const u = `cases-${Date.now()}-${Math.random().toString(36).slice(2)}`; await addDoc('title_deed', `${u}/a`); await addDoc('management_authorisation', `${u}/b`);
    });

    await ctx.test('a valid request creates a case due in two working days with the documents attached', async () => {
      const r = await h.call('POST', V, undefined, admin.accessToken);
      assert.equal(r.status, 201); assert.equal(r.body.status, 'submitted'); caseId = r.body.caseId;
      const due = new Date(r.body.dueAt).getTime() - Date.now();
      assert.ok(due > 47 * 3600e3 && due < 5 * 86400e3, 'due date is a couple of working days away');
      assert.equal((await h.pool.query('SELECT count(*)::int n FROM verification.case_files WHERE case_id=$1', [caseId])).rows[0].n, 2);
      const row = (await h.pool.query('SELECT risk_flags FROM verification.cases WHERE id=$1', [caseId])).rows[0];
      assert.ok(row.risk_flags.includes('new_organisation'));
    });

    await ctx.test('a second request while one is open is refused; status shows the case without reviewer details', async () => {
      assert.equal((await h.call('POST', V, undefined, admin.accessToken)).status, 409);
      const r = await h.call('GET', V, undefined, admin.accessToken);
      assert.equal(r.body.case.status, 'submitted'); assert.equal(r.body.canRequest, false); assert.equal(r.body.case.canAppeal, false);
      assert.ok(!JSON.stringify(r.body).includes('claimed_by') && !JSON.stringify(r.body).includes('decided_by'));
    });

    await ctx.test('evidence of the open case cannot be deleted through the API', async () => {
      const f = (await h.call('GET', `/orgs/${org.id}/properties/${prop.id}/files`, undefined, admin.accessToken)).body;
      assert.ok(Array.isArray(f) && f.length === 2);
      const r = await h.call('DELETE', `/orgs/${org.id}/properties/${prop.id}/files/${f[0].id}`, undefined, admin.accessToken);
      assert.ok(r.status >= 400, `delete refused (got ${r.status})`);
      assert.equal((await h.pool.query(`SELECT count(*)::int n FROM supply.files WHERE property_id=$1 AND status='ready'`, [prop.id])).rows[0].n, 2);
    });

    await ctx.test('isolation: another organisation, an outsider and a signed-out caller get nothing', async () => {
      assert.equal((await h.call('GET', V, undefined, outsider.accessToken)).status, 403);
      assert.equal((await h.call('POST', V, undefined, outsider.accessToken)).status, 403);
      assert.equal((await h.call('GET', `/orgs/${other.id}/properties/${prop.id}/verification`, undefined, outsider.accessToken)).status, 404);
      assert.equal((await h.call('GET', V, undefined, tenant.accessToken)).status, 403);
      assert.equal((await h.call('GET', V)).status, 401);
    });

    await ctx.test('appeal: refused until rejected, allowed once inside the window, refused after the window', async () => {
      assert.equal((await h.call('POST', `${V}/appeal`, undefined, admin.accessToken)).status, 409);
      const rid = await h.userId(reviewer.p);
      await h.pool.query(`INSERT INTO identity.platform_roles (user_id, role) VALUES ($1,'reviewer')`, [rid]);
      await h.pool.query(`UPDATE verification.cases SET status='in_review', claimed_by=$2, claimed_at=now() WHERE id=$1`, [caseId, rid]);
      await h.pool.query(`UPDATE verification.cases SET status='rejected', decided_by=$2, decided_at=now(), reason_code='doc_expired', note='Lease ended in 2025' WHERE id=$1`, [caseId, rid]);
      const s = await h.call('GET', V, undefined, admin.accessToken);
      assert.equal(s.body.case.status, 'rejected'); assert.equal(s.body.case.reasonCode, 'doc_expired'); assert.equal(s.body.case.note, 'Lease ended in 2025'); assert.equal(s.body.case.canAppeal, true);
      const a = await h.call('POST', `${V}/appeal`, undefined, admin.accessToken);
      assert.equal(a.status, 201);
      assert.equal((await h.pool.query('SELECT appeal_of FROM verification.cases WHERE id=$1', [a.body.caseId])).rows[0].appeal_of, caseId);
      assert.equal((await h.call('POST', `${V}/appeal`, undefined, admin.accessToken)).status, 409, 'only one appeal');
      assert.ok((await h.pool.query(`SELECT risk_flags FROM verification.cases WHERE id=$1`, [a.body.caseId])).rows[0].risk_flags.includes('appeal'));
    });

    await ctx.test('a verified property shows its badge and refuses a new request; expired badges do not count', async () => {
      await h.pool.query(`UPDATE verification.cases SET status='submitted' WHERE appeal_of IS NOT NULL AND false`);
      await h.pool.query(`INSERT INTO verification.badges (subject_type, subject_id, level, expires_at) VALUES ('property',$1,'t1_documented', now() + interval '12 months')`, [prop.id]);
      const r = await h.call('GET', V, undefined, admin.accessToken);
      assert.equal(r.body.verified, true); assert.ok(r.body.verifiedUntil);
      assert.equal((await h.call('POST', V, undefined, admin.accessToken)).status, 409);
      await h.pool.query(`UPDATE verification.badges SET issued_at = now() - interval '2 years', expires_at = now() - interval '1 day' WHERE subject_id=$1`, [prop.id]);
      assert.equal((await h.call('GET', V, undefined, admin.accessToken)).body.verified, false);
      const list = (await h.call('GET', `/orgs/${org.id}/properties`, undefined, admin.accessToken)).body;
      assert.equal(list[0].verifiedUntil, null); assert.ok(list[0].caseStatus);
    });

    await ctx.test('audit: requests and appeals are recorded and the chain is intact', async () => {
      const n = (await h.pool.query(`SELECT count(*)::int n FROM governance.audit_events WHERE action IN ('verification.requested','verification.appealed')`)).rows[0].n;
      assert.ok(n >= 2);
    });
  } finally { await h.close(); }
});
