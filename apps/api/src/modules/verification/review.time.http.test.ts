import test from 'node:test';
import assert from 'node:assert/strict';
import { bootApp } from '../../test-utils/http';

const t = process.env.DATABASE_URL ? test : test.skip;
const MIN = 60e3, H = 3600e3;

t('S6b: time record for decided, released, sent-back and admin-released cases; own-organisation refusals; stale-claim release', async (ctx) => {
  const h = await bootApp();
  try {
    const mgr = await h.login(), insider = await h.login(), r1 = await h.login(), r2 = await h.login(), adm = await h.login();
    const org = (await h.call('POST', '/orgs', { name: 'Time Agents', kind: 'agency' }, mgr.accessToken)).body;
    const mgrId = await h.userId(mgr.p), r1Id = await h.userId(r1.p), r2Id = await h.userId(r2.p), insiderId = await h.userId(insider.p), admId = await h.userId(adm.p);
    for (const id of [r1Id, r2Id, insiderId]) await h.pool.query(`INSERT INTO identity.platform_roles (user_id, role) VALUES ($1,'reviewer') ON CONFLICT DO NOTHING`, [id]);
    await h.pool.query(`INSERT INTO identity.platform_roles (user_id, role) VALUES ($1,'super_admin') ON CONFLICT DO NOTHING`, [admId]);
    await h.pool.query(`INSERT INTO identity.memberships (user_id, org_id, role) VALUES ($1,$2,'manager_staff')`, [insiderId, org.id]);
    // roles are read when a session starts, so sign the admin in again after granting the role
    const adm2 = await h.login(adm.p);

    const mk = async (name: string) => {
      const p = (await h.call('POST', `/orgs/${org.id}/properties`, { name, addressText: `${name} Road` }, mgr.accessToken)).body;
      return (await h.pool.query(
        `INSERT INTO verification.cases (org_id, property_id, status, submitted_by, submitted_at, due_at) VALUES ($1,$2,'submitted',$3, now() - interval '1 day', now() + interval '2 days') RETURNING id`, [org.id, p.id, mgrId])).rows[0].id as string;
    };
    const sessions = async (caseId: string) => (await h.pool.query(`SELECT * FROM verification.review_sessions WHERE case_id=$1 ORDER BY ended_at`, [caseId])).rows;
    /** Pretend the claim happened `ago` ms in the past, with document openings at the given offsets (ms after the claim). */
    const backdate = async (caseId: string, reviewerId: string, ago: number, opens: number[] = []) => {
      const claimed = new Date(Date.now() - ago);
      await h.pool.query(`UPDATE verification.cases SET claimed_at=$2 WHERE id=$1`, [caseId, claimed]);
      for (const o of opens) await h.pool.query(`INSERT INTO governance.data_access_log (accessed_at, accessor_id, resource, reason) VALUES ($1,$2,'file:document',$3)`, [new Date(claimed.getTime() + o), reviewerId, `case ${caseId} file 00000000-0000-4000-8000-000000000001`]);
    };

    const cRel = await mk('Released'), cRej = await mk('Rejected'), cNc = await mk('SentBack'), cStale = await mk('Stale'), cFresh = await mk('Fresh'), cOwn = await mk('Own');

    await ctx.test('release writes a time record with the 30-minute cap', async () => {
      assert.equal((await h.call('POST', `/review/cases/${cRel}/claim`, undefined, r1.accessToken)).status, 200);
      await backdate(cRel, r1Id, 3 * H, [10 * MIN]);          // claim, opened after 10 min, then nothing for 2 h 50 min
      assert.equal((await h.call('POST', `/review/cases/${cRel}/release`, undefined, r1.accessToken)).status, 200);
      const [s, ...rest] = await sessions(cRel);
      assert.equal(rest.length, 0); assert.equal(s.end_reason, 'released'); assert.equal(s.reviewer_id, r1Id);
      assert.ok(Math.abs(s.elapsed_seconds - 3 * 3600) < 5);
      assert.equal(s.handling_seconds, 600 + 1800); assert.equal(s.opens, 1);
      assert.equal((await h.pool.query('SELECT claimed_at FROM verification.cases WHERE id=$1', [cRel])).rows[0].claimed_at, null);   // the case forgets, the record remembers
    });

    await ctx.test('a failed release (not the holder) writes nothing', async () => {
      assert.equal((await h.call('POST', `/review/cases/${cRel}/release`, undefined, r2.accessToken)).status, 404);
      assert.equal((await sessions(cRel)).length, 1);
    });

    await ctx.test('a decision writes a "decided" record; sending back writes "sent_back"', async () => {
      assert.equal((await h.call('POST', `/review/cases/${cRej}/claim`, undefined, r2.accessToken)).status, 200);
      await backdate(cRej, r2Id, 20 * MIN);
      const d = await h.call('POST', `/review/cases/${cRej}/decision`, { decision: 'reject', reasonCode: 'doc_expired' }, r2.accessToken);
      assert.equal(d.status, 200, JSON.stringify(d.body));
      const s = (await sessions(cRej))[0];
      assert.equal(s.end_reason, 'decided'); assert.equal(s.reviewer_id, r2Id); assert.equal(s.handling_seconds, s.elapsed_seconds); assert.ok(Math.abs(s.elapsed_seconds - 1200) < 5);

      assert.equal((await h.call('POST', `/review/cases/${cNc}/claim`, undefined, r2.accessToken)).status, 200);
      await backdate(cNc, r2Id, 5 * MIN);
      const n = await h.call('POST', `/review/cases/${cNc}/decision`, { decision: 'needs_changes', reasonCode: 'doc_unreadable' }, r2.accessToken);
      assert.equal(n.status, 200, JSON.stringify(n.body));
      const s2 = (await sessions(cNc))[0];
      assert.equal(s2.end_reason, 'sent_back'); assert.ok(Math.abs(s2.elapsed_seconds - 300) < 5);
      assert.equal((await h.pool.query('SELECT claimed_at FROM verification.cases WHERE id=$1', [cNc])).rows[0].claimed_at, null);
    });

    await ctx.test('a refused decision (not the holder) writes no time record', async () => {
      const before = (await h.pool.query('SELECT count(*)::int n FROM verification.review_sessions')).rows[0].n;
      assert.equal((await h.call('POST', `/review/cases/${cStale}/decision`, { decision: 'reject', reasonCode: 'doc_expired' }, r1.accessToken)).status, 404);
      assert.equal((await h.pool.query('SELECT count(*)::int n FROM verification.review_sessions')).rows[0].n, before);
    });

    await ctx.test('own-organisation claim: same plain 404, but the attempt is recorded', async () => {
      const r = await h.call('POST', `/review/cases/${cOwn}/claim`, undefined, insider.accessToken);
      assert.equal(r.status, 404);
      assert.equal((await h.pool.query('SELECT status FROM verification.cases WHERE id=$1', [cOwn])).rows[0].status, 'submitted');
      const a = (await h.pool.query(`SELECT actor_id FROM governance.audit_events WHERE action='verification.own_org_claim_refused' AND subject_id=$1`, [cOwn])).rows;
      assert.equal(a.length, 1); assert.equal(a[0].actor_id, insiderId);
      // an unrelated "not found" is not recorded as an own-organisation attempt
      assert.equal((await h.call('POST', `/review/cases/00000000-0000-4000-8000-000000000000/claim`, undefined, insider.accessToken)).status, 404);
      assert.equal((await h.pool.query(`SELECT count(*)::int n FROM governance.audit_events WHERE action='verification.own_org_claim_refused' AND actor_id=$1`, [insiderId])).rows[0].n, 1);
    });

    await ctx.test('stale claims: admin only; list, refuse a fresh claim, release a stale one with a reason', async () => {
      assert.equal((await h.call('POST', `/review/cases/${cStale}/claim`, undefined, r1.accessToken)).status, 200);
      assert.equal((await h.call('POST', `/review/cases/${cFresh}/claim`, undefined, r2.accessToken)).status, 200);
      await backdate(cStale, r1Id, 5 * H, [5 * MIN]);
      for (const [who, code] of [[mgr, 403], [r1, 403]] as const) {
        assert.equal((await h.call('GET', '/admin/review/stale-claims', undefined, who.accessToken)).status, code);
        assert.equal((await h.call('POST', `/admin/review/cases/${cStale}/release`, { reason: 'try it on' }, who.accessToken)).status, code);
      }
      assert.equal((await h.call('GET', '/admin/review/stale-claims')).status, 401);

      const list = (await h.call('GET', '/admin/review/stale-claims', undefined, adm2.accessToken)).body;
      assert.equal(list.thresholdHours, 4);
      assert.ok(list.claims.some((c: any) => c.id === cStale && c.heldMinutes >= 299));
      assert.ok(!list.claims.some((c: any) => c.id === cFresh));
      assert.ok(!JSON.stringify(list).includes('Stale Road'), 'no case contents');
      assert.ok((await h.pool.query(`SELECT count(*)::int n FROM governance.data_access_log WHERE accessor_id=$1 AND resource='admin_stale_claims'`, [admId])).rows[0].n >= 1, 'the admin view is logged');

      assert.equal((await h.call('POST', `/admin/review/cases/${cStale}/release`, {}, adm2.accessToken)).status, 400);
      assert.equal((await h.call('POST', `/admin/review/cases/${cFresh}/release`, { reason: 'trying a fresh one' }, adm2.accessToken)).status, 409);
      assert.equal((await h.call('POST', `/admin/review/cases/${cRej}/release`, { reason: 'a decided case' }, adm2.accessToken)).status, 404);
      const ok = await h.call('POST', `/admin/review/cases/${cStale}/release`, { reason: 'Reviewer went offline mid-review' }, adm2.accessToken);
      assert.equal(ok.status, 200, JSON.stringify(ok.body));

      const row = (await h.pool.query('SELECT status, claimed_by FROM verification.cases WHERE id=$1', [cStale])).rows[0];
      assert.equal(row.status, 'submitted'); assert.equal(row.claimed_by, null);
      const s = (await sessions(cStale))[0];
      assert.equal(s.end_reason, 'admin_released'); assert.equal(s.reviewer_id, r1Id); assert.equal(s.handling_seconds, 300 + 1800);
      const a = (await h.pool.query(`SELECT actor_id, metadata FROM governance.audit_events WHERE action='verification.case_admin_released' AND subject_id=$1`, [cStale])).rows;
      assert.equal(a.length, 1); assert.equal(a[0].actor_id, admId); assert.equal(a[0].metadata.reason, 'Reviewer went offline mid-review'); assert.equal(a[0].metadata.reviewerId, r1Id);
      assert.equal((await h.call('POST', `/review/cases/${cStale}/claim`, undefined, r2.accessToken)).status, 200, 'back in the queue for another reviewer');
    });

    await ctx.test('the time record never changes a case outcome', async () => {
      assert.equal((await h.pool.query('SELECT status FROM verification.cases WHERE id=$1', [cRej])).rows[0].status, 'rejected');
      assert.equal((await h.pool.query('SELECT status FROM verification.cases WHERE id=$1', [cNc])).rows[0].status, 'needs_changes');
    });
  } finally { await h.close(); }
});
