import test from 'node:test';
import assert from 'node:assert/strict';
import { bootApp } from '../../test-utils/http';

process.env.STORAGE_DRIVER = 'fake';
const t = process.env.DATABASE_URL ? test : test.skip;

t('case page, 5-minute document links and decisions over HTTP', async (ctx) => {
  const h = await bootApp();
  try {
    const mgr = await h.login(), r1 = await h.login(), r2 = await h.login();
    const org = (await h.call('POST', '/orgs', { name: 'Decision Agents', kind: 'agency' }, mgr.accessToken)).body;
    const mgrId = await h.userId(mgr.p), r1Id = await h.userId(r1.p), r2Id = await h.userId(r2.p);
    for (const id of [r1Id, r2Id]) await h.pool.query(`INSERT INTO identity.platform_roles (user_id, role) VALUES ($1,'reviewer') ON CONFLICT DO NOTHING`, [id]);
    await h.pool.query(`INSERT INTO verification.badges (subject_type, subject_id, level, expires_at) VALUES ('user',$1,'id_verified', now() + interval '1 year')`, [mgrId]);
    const u = `dec-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let n = 0;
    const doc = async (propId: string, type: string) => (await h.pool.query(
      `INSERT INTO supply.files (id, org_id, property_id, kind, doc_type, original_name, storage_path, mime_type, size_bytes, status, uploaded_by, ready_at)
       VALUES (gen_random_uuid(), $1,$2,'document',$3,$4,$5,'application/pdf',1000,'ready',$6, now() - interval '3 hours') RETURNING id`, [org.id, propId, type, `${type}.pdf`, `${u}/${++n}`, mgrId])).rows[0].id as string;
    const prop = async (name: string) => (await h.call('POST', `/orgs/${org.id}/properties`, { name, addressText: `${name} Road` }, mgr.accessToken)).body;
    const V = (pid: string, tail = '') => `/orgs/${org.id}/properties/${pid}/verification${tail}`;
    const submit = async (pid: string) => { await doc(pid, 'title_deed'); await doc(pid, 'management_authorisation'); return (await h.call('POST', V(pid), undefined, mgr.accessToken)).body.caseId as string; };
    const claim = (cid: string, r = r1) => h.call('POST', `/review/cases/${cid}/claim`, undefined, r.accessToken);
    const decide = (cid: string, body: any, r = r1) => h.call('POST', `/review/cases/${cid}/decision`, body, r.accessToken);

    const pA = await prop('Alpha'), caseA = await submit(pA.id);
    const filesA = (await h.pool.query('SELECT file_id FROM verification.case_files WHERE case_id=$1 ORDER BY file_id', [caseA])).rows.map((r: any) => r.file_id);
    const pOther = await prop('Elsewhere'); const strayDoc = await doc(pOther.id, 'title_deed');

    await ctx.test('only the holder sees the case page, and the read is logged', async () => {
      assert.equal((await h.call('GET', `/review/cases/${caseA}`, undefined, r1.accessToken)).status, 404, 'not claimed yet');
      assert.equal((await claim(caseA)).status, 200);
      assert.equal((await h.call('GET', `/review/cases/${caseA}`, undefined, r2.accessToken)).status, 404);
      assert.equal((await h.call('GET', `/review/cases/${caseA}`, undefined, mgr.accessToken)).status, 403);
      const r = await h.call('GET', `/review/cases/${caseA}`, undefined, r1.accessToken);
      assert.equal(r.status, 200); assert.equal(r.body.files.length, 2); assert.equal(r.body.allOpened, false); assert.equal(r.body.propertyName, 'Alpha');
      assert.ok(r.body.files.every((f: any) => f.opened === false && f.originalName));
      assert.ok((await h.pool.query(`SELECT count(*)::int n FROM governance.data_access_log WHERE accessor_id=$1 AND resource='verification_case' AND reason=$2`, [r1Id, `case ${caseA}`])).rows[0].n >= 1);
    });

    await ctx.test('document links: five minutes, attached documents only, holder only, every open logged and audited', async () => {
      const L = (cid: string, fid: string, r = r1) => h.call('POST', `/review/cases/${cid}/files/${fid}/link`, undefined, r.accessToken);
      assert.equal((await L(caseA, strayDoc)).status, 404, 'a document of another property is not reachable');
      assert.equal((await L(caseA, filesA[0], r2)).status, 404, 'another reviewer cannot open it');
      assert.equal((await L(caseA, filesA[0], mgr)).status, 403);
      const a = await L(caseA, filesA[0]);
      assert.equal(a.status, 200); assert.equal(a.body.expiresInSec, 300); assert.ok(a.body.url.includes('ttl=300'));
      const log = (await h.pool.query(`SELECT subject_user_id FROM governance.data_access_log WHERE accessor_id=$1 AND resource='file:document' AND reason=$2`, [r1Id, `case ${caseA} file ${filesA[0]}`])).rows;
      assert.equal(log.length, 1); assert.equal(log[0].subject_user_id, mgrId);
      assert.equal((await h.pool.query(`SELECT count(*)::int n FROM governance.audit_events WHERE action='verification.document_opened' AND subject_id=$1`, [caseA])).rows[0].n, 1);
      const page = (await h.call('GET', `/review/cases/${caseA}`, undefined, r1.accessToken)).body;
      assert.equal(page.files.filter((f: any) => f.opened).length, 1); assert.equal(page.allOpened, false);
    });

    await ctx.test('decisions are validated and cannot be made by someone else', async () => {
      for (const body of [{}, { decision: 'maybe' }, { decision: 'reject' }, { decision: 'reject', reasonCode: 'nope' }, { decision: 'reject', reasonCode: 'other' }, { decision: 'approve', reasonCode: 'doc_expired' }, { decision: 'reject', reasonCode: 'doc_expired', note: 'x'.repeat(501) }])
        assert.equal((await decide(caseA, body)).status, 400, JSON.stringify(body));
      assert.equal((await decide(caseA, { decision: 'approve' }, r2)).status, 404);
      assert.equal((await h.call('POST', `/review/cases/${caseA}/decision`, { decision: 'approve' }, mgr.accessToken)).status, 403);
      assert.equal((await h.pool.query('SELECT status FROM verification.cases WHERE id=$1', [caseA])).rows[0].status, 'in_review');
    });

    await ctx.test('approval needs every document opened, then issues a 12-month badge', async () => {
      const early = await decide(caseA, { decision: 'approve' });
      assert.equal(early.status, 422); assert.equal(early.body.code, 'documents_not_opened');
      await h.call('POST', `/review/cases/${caseA}/files/${filesA[1]}/link`, undefined, r1.accessToken);
      assert.equal((await h.call('GET', `/review/cases/${caseA}`, undefined, r1.accessToken)).body.allOpened, true);
      const ok = await decide(caseA, { decision: 'approve' });
      assert.equal(ok.status, 200); assert.equal(ok.body.status, 'approved'); assert.ok(ok.body.badgeId);
      const b = (await h.pool.query(`SELECT level, subject_id, verified_by, expires_at, issued_at FROM verification.badges WHERE id=$1`, [ok.body.badgeId])).rows[0];
      assert.equal(b.level, 't1_documented'); assert.equal(b.subject_id, pA.id); assert.equal(b.verified_by, r1Id);
      const months = (new Date(b.expires_at).getTime() - new Date(b.issued_at).getTime()) / 86400e3;
      assert.ok(months > 364 && months < 367, `about a year (${months} days)`);
      const m = await h.call('GET', V(pA.id), undefined, mgr.accessToken);
      assert.equal(m.body.verified, true); assert.equal(m.body.case.status, 'approved');
      assert.ok(!JSON.stringify(m.body).includes(r1Id), 'the manager never learns who decided');
      assert.equal((await decide(caseA, { decision: 'approve' })).status, 409, 'a decision is final');
      assert.equal((await h.call('GET', `/review/cases/${caseA}`, undefined, r1.accessToken)).body.decided.status, 'approved', 'the decider can still read it');
      const del = await h.call('DELETE', `/orgs/${org.id}/properties/${pA.id}/files/${filesA[0]}`, undefined, mgr.accessToken);
      assert.ok(del.status >= 400, 'evidence of an approved case cannot be deleted');
    });

    const pB = await prop('Bravo'), caseB = await submit(pB.id);
    await claim(caseB);
    await ctx.test('rejection stores reason and note, the manager sees them, then one appeal goes to a different reviewer', async () => {
      const rej = await decide(caseB, { decision: 'reject', reasonCode: 'doc_expired', note: 'Lease ended in 2025' });
      assert.equal(rej.status, 200); assert.equal(rej.body.status, 'rejected');
      const m = (await h.call('GET', V(pB.id), undefined, mgr.accessToken)).body;
      assert.equal(m.case.status, 'rejected'); assert.equal(m.case.reasonCode, 'doc_expired'); assert.equal(m.case.note, 'Lease ended in 2025'); assert.equal(m.case.canAppeal, true);
      const ap = await h.call('POST', V(pB.id, '/appeal'), undefined, mgr.accessToken); assert.equal(ap.status, 201);
      assert.equal((await claim(ap.body.caseId, r1)).status, 404, 'the first reviewer never sees the appeal');
      assert.equal((await claim(ap.body.caseId, r2)).status, 200);
      const page = (await h.call('GET', `/review/cases/${ap.body.caseId}`, undefined, r2.accessToken)).body;
      assert.equal(page.isAppeal, true); assert.equal(page.earlierDecision.reasonCode, 'doc_expired'); assert.ok(!JSON.stringify(page).includes(r1Id));
      for (const f of page.files) await h.call('POST', `/review/cases/${ap.body.caseId}/files/${f.id}/link`, undefined, r2.accessToken);
      const fin = await decide(ap.body.caseId, { decision: 'approve' }, r2);
      assert.equal(fin.status, 200, JSON.stringify(fin.body));
      assert.equal((await h.call('GET', V(pB.id), undefined, mgr.accessToken)).body.verified, true);
    });

    const pC = await prop('Charlie'), caseC = await submit(pC.id);
    await claim(caseC);
    await ctx.test('needs changes: the claim is released, the manager fixes and resubmits, the clock resumes', async () => {
      assert.equal((await h.call('POST', V(pC.id, '/resubmit'), undefined, mgr.accessToken)).status, 409, 'nothing to resubmit yet');
      const nc = await decide(caseC, { decision: 'needs_changes', reasonCode: 'doc_unreadable', note: 'Page 2 is blurred' });
      assert.equal(nc.status, 200);
      const row = (await h.pool.query('SELECT status, claimed_by, paused_at, decided_by FROM verification.cases WHERE id=$1', [caseC])).rows[0];
      assert.equal(row.status, 'needs_changes'); assert.equal(row.claimed_by, null); assert.ok(row.paused_at); assert.equal(row.decided_by, null);
      const m = (await h.call('GET', V(pC.id), undefined, mgr.accessToken)).body;
      assert.equal(m.case.status, 'needs_changes'); assert.equal(m.case.reasonCode, 'doc_unreadable'); assert.equal(m.case.canResubmit, true); assert.equal(m.canRequest, false);
      const newDoc = await doc(pC.id, 'lease_agreement');
      const rs = await h.call('POST', V(pC.id, '/resubmit'), undefined, mgr.accessToken);
      assert.equal(rs.status, 201); assert.equal(rs.body.status, 'submitted');
      const after = (await h.pool.query('SELECT status, paused_at, reason_code FROM verification.cases WHERE id=$1', [caseC])).rows[0];
      assert.equal(after.status, 'submitted'); assert.equal(after.paused_at, null); assert.equal(after.reason_code, null);
      assert.ok((await h.pool.query('SELECT 1 FROM verification.case_files WHERE case_id=$1 AND file_id=$2', [caseC, newDoc])).rowCount, 'the new document is attached');
      assert.equal((await claim(caseC, r2)).status, 200, 'any reviewer can take it again');
    });

    await ctx.test('audit trail covers claims, opens, decisions and resubmission', async () => {
      const a = (await h.pool.query(`SELECT action, count(*)::int n FROM governance.audit_events WHERE subject_id = ANY($1) GROUP BY 1`, [[caseA, caseB, caseC]])).rows;
      const m = Object.fromEntries(a.map((r: any) => [r.action, r.n]));
      for (const k of ['verification.document_opened', 'verification.approved', 'verification.rejected', 'verification.needs_changes', 'verification.resubmitted', 'verification.case_claimed']) assert.ok(m[k] >= 1, k);
    });
  } finally { await h.close(); }
});
