import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { bootApp } from '../../test-utils/http';

process.env.STORAGE_DRIVER = 'fake';
const t = process.env.DATABASE_URL ? test : test.skip;
const MIN = 60e3, H = 3600e3;
const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * S6f acceptance run (design note S6). Three reviewers work twelve documented (T1) cases through the real endpoints: claim, open documents,
 * approve, reject, send back, release, a stale claim and an own-organisation attempt. Afterwards every figure in the admin reports is checked
 * against counts kept by this test, and the oversight rules are checked: admin only, alerts advisory, audit chain.
 * The reports cover the whole month, so each report figure is compared as "after minus before" and must equal what this run did.
 * Set S6F_REPORT=/path/report.json to keep the results.
 */
t('S6f acceptance: three reviewers, time record, reports, alerts, stale claim, access and audit integrity', { timeout: 300_000 }, async () => {
  const h = await bootApp();
  const checks: { name: string; ok: boolean; detail: string }[] = [];
  const check = async (name: string, fn: () => Promise<string | void>) => {
    try { checks.push({ name, ok: true, detail: (await fn()) || '' }); } catch (e: any) { checks.push({ name, ok: false, detail: String(e?.message ?? e).split('\n')[0] }); }
  };
  try {
    // ---------- people ----------
    const mgr = await h.login(), insider = await h.login(), plain = await h.login();
    const rv = [await h.login(), await h.login(), await h.login()];
    const adminLogin = await h.login();
    const mgrId = await h.userId(mgr.p), insiderId = await h.userId(insider.p), adminId = await h.userId(adminLogin.p);
    const rvId = await Promise.all(rv.map((r) => h.userId(r.p)));
    for (const id of [...rvId, insiderId]) await h.pool.query(`INSERT INTO identity.platform_roles (user_id, role) VALUES ($1,'reviewer') ON CONFLICT DO NOTHING`, [id]);
    await h.pool.query(`INSERT INTO identity.platform_roles (user_id, role) VALUES ($1,'super_admin') ON CONFLICT DO NOTHING`, [adminId]);
    const adm = await h.login(adminLogin.p);      // roles are read at sign-in
    const [A, B, C] = rv;
    const org = (await h.call('POST', '/orgs', { name: 'S6f Acceptance Agents', kind: 'agency' }, mgr.accessToken)).body;
    await h.pool.query(`INSERT INTO identity.memberships (user_id, org_id, role) VALUES ($1,$2,'manager_staff')`, [insiderId, org.id]);
    await h.pool.query(`INSERT INTO verification.badges (subject_type, subject_id, level, expires_at) VALUES ('user',$1,'id_verified', now() + interval '1 year')`, [mgrId]);

    const u = `s6f-${Date.now()}-${Math.random().toString(36).slice(2)}`; let n = 0;
    const doc = async (propId: string, type: string) => h.pool.query(
      `INSERT INTO supply.files (id, org_id, property_id, kind, doc_type, original_name, storage_path, mime_type, size_bytes, status, uploaded_by, ready_at)
       VALUES (gen_random_uuid(), $1,$2,'document',$3,$4,$5,'application/pdf',1000,'ready',$6, now() - interval '3 hours')`, [org.id, propId, type, `${type}.pdf`, `${u}/${++n}`, mgrId]);
    const submit = async (name: string) => {
      const p = (await h.call('POST', `/orgs/${org.id}/properties`, { name, addressText: `${name} Road` }, mgr.accessToken)).body;
      await doc(p.id, 'title_deed'); await doc(p.id, 'management_authorisation');
      const r = await h.call('POST', `/orgs/${org.id}/properties/${p.id}/verification`, undefined, mgr.accessToken);
      assert.equal(r.status, 201, JSON.stringify(r.body));
      return r.body.caseId as string;
    };
    const claim = (id: string, who: any) => h.call('POST', `/review/cases/${id}/claim`, undefined, who.accessToken);
    /** Pretend the claim happened `ago` ms in the past (the clock cannot be waited out in a test). */
    const backdate = (id: string, ago: number) => h.pool.query(`UPDATE verification.cases SET claimed_at = now() - ($2 || ' milliseconds')::interval WHERE id=$1`, [id, String(ago)]);
    const openAll = async (id: string, who: any) => {
      const page = await h.call('GET', `/review/cases/${id}`, undefined, who.accessToken); assert.equal(page.status, 200);
      for (const f of page.body.files) assert.equal((await h.call('POST', `/review/cases/${id}/files/${f.id}/link`, undefined, who.accessToken)).status, 200);
    };
    const decide = (id: string, who: any, body: any) => h.call('POST', `/review/cases/${id}/decision`, body, who.accessToken);

    // ---------- baseline from the reports, before this run does anything ----------
    const G = (path: string, tok = adm.accessToken) => h.call('GET', path, undefined, tok);
    const month = (await G('/admin/reports/queue')).body.month as string;
    const q0 = (await G(`/admin/reports/queue?month=${month}`)).body.tiers.t1;
    const c0 = (await G(`/admin/reports/cost?month=${month}`)).body.tiers.t1;
    const rv0 = (await G(`/admin/reports/reviewers?month=${month}`)).body.reviewers as any[];
    const base = (id: string) => rv0.find((x) => x.reviewerId === id) ?? { decisions: 0, approved: 0, sentBack: 0, released: 0, handlingHours: 0 };

    // ---------- the run: expected figures are kept here as the work is done ----------
    const names = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'c10', 'c11', 'c12'];
    const id: Record<string, string> = {};
    for (const k of names) id[k] = await submit(`S6f ${u} ${k}`);
    /** what each reviewer should show: decisions, approvals, sent back, released, handling seconds */
    const exp = rvId.map(() => ({ decisions: 0, approved: 0, sentBack: 0, released: 0, secs: 0 }));
    let decidedNew = 0, approvedNew = 0, rejectedNew = 0, returnedNew = 0, secsNew = 0;
    const cap = (ms: number) => Math.min(ms, 30 * MIN) / 1000;
    const work = async (k: string, who: any, ix: number, ago: number, how: 'approve' | 'reject' | 'send_back' | 'release') => {
      assert.equal((await claim(id[k], who)).status, 200, `${k} claimed`);
      await backdate(id[k], ago);
      if (how === 'release') {
        assert.equal((await h.call('POST', `/review/cases/${id[k]}/release`, undefined, who.accessToken)).status, 200); exp[ix].released++;
      } else {
        if (how === 'approve') await openAll(id[k], who);
        const body = how === 'approve' ? { decision: 'approve' } : how === 'reject' ? { decision: 'reject', reasonCode: 'doc_expired' } : { decision: 'needs_changes', reasonCode: 'doc_unreadable' };
        const d = await decide(id[k], who, body); assert.equal(d.status, 200, `${k}: ${JSON.stringify(d.body)}`);
        if (how === 'send_back') { exp[ix].sentBack++; returnedNew++; }
        else { exp[ix].decisions++; decidedNew++; if (how === 'approve') { exp[ix].approved++; approvedNew++; } else rejectedNew++; }
      }
      exp[ix].secs += cap(ago); secsNew += cap(ago);
    };
    await work('c1', A, 0, 12 * MIN, 'approve');
    await work('c2', A, 0, 45 * MIN, 'approve');          // 45 minutes elapsed: only 30 count
    await work('c3', A, 0, 8 * MIN, 'reject');
    await work('c4', B, 1, 20 * MIN, 'approve');
    await work('c5', B, 1, 5 * MIN, 'send_back');
    await work('c6', B, 1, 3 * H, 'release');             // walked away: capped at 30 minutes
    await work('c6', C, 2, 6 * MIN, 'approve');           // C picks it up and approves
    await work('c7', C, 2, 25 * MIN, 'reject');
    await work('c8', C, 2, 10 * MIN, 'approve');
    // c9: held by B for 5 hours (stale); c10: held by C for 10 minutes (fresh); c11 and c12 untouched
    assert.equal((await claim(id.c9, B)).status, 200); await backdate(id.c9, 5 * H);
    assert.equal((await claim(id.c10, C)).status, 200); await backdate(id.c10, 10 * MIN);

    const near = (got: number, want: number, tol: number, what: string) => assert.ok(Math.abs(got - want) <= tol, `${what}: got ${got}, expected ${want} (+/- ${tol})`);

    // ---------- checks ----------
    await check('Time record: every decided, sent-back and released stretch has one record with the right reason and the 30-minute cap', async () => {
      const rows = (await h.pool.query(`SELECT case_id, reviewer_id, end_reason, handling_seconds, elapsed_seconds FROM verification.review_sessions WHERE case_id = ANY($1)`, [Object.values(id)])).rows;
      const of = (k: string) => rows.filter((r: any) => r.case_id === id[k]);
      assert.equal(rows.length, 9, 'nine finished stretches (c1-c8 and the released c6), c9 and c10 still running'); // c1,c2,c3,c4,c5,c6x2,c7,c8
      assert.equal(of('c2')[0].end_reason, 'decided'); near(of('c2')[0].handling_seconds, 1800, 5, 'c2 capped');
      assert.ok(of('c2')[0].elapsed_seconds >= 2700 - 5, 'elapsed time is kept in full');
      near(of('c1')[0].handling_seconds, 720, 5, 'c1');
      assert.equal(of('c5')[0].end_reason, 'sent_back'); near(of('c5')[0].handling_seconds, 300, 5, 'c5');
      const c6 = of('c6'); assert.equal(c6.length, 2);
      assert.deepEqual(c6.map((r: any) => r.end_reason).sort(), ['decided', 'released']);
      near(c6.find((r: any) => r.end_reason === 'released').handling_seconds, 1800, 5, 'c6 released, capped');
      assert.equal(c6.find((r: any) => r.end_reason === 'released').reviewer_id, rvId[1]); assert.equal(c6.find((r: any) => r.end_reason === 'decided').reviewer_id, rvId[2]);
      assert.equal(of('c9').length + of('c10').length, 0, 'a running claim writes nothing until it ends');
      return 'decided, sent back and released stretches recorded; 45 minutes counted as 30; the released case and its second reviewer each have their own record';
    });

    await check('Own organisation: the claim is refused with the plain 404 and the attempt is recorded', async () => {
      assert.equal((await claim(id.c11, insider)).status, 404);
      assert.equal((await h.pool.query(`SELECT status FROM verification.cases WHERE id=$1`, [id.c11])).rows[0].status, 'submitted');
      const a = (await h.pool.query(`SELECT actor_id FROM governance.audit_events WHERE action='verification.own_org_claim_refused' AND subject_id=$1`, [id.c11])).rows;
      assert.equal(a.length, 1); assert.equal(a[0].actor_id, insiderId);
      return 'refused, left in the queue, recorded against the account';
    });

    await check('Reviewer figures: the admin report and each reviewer\'s own page match the counts kept during the run', async () => {
      const rep = (await G(`/admin/reports/reviewers?month=${month}`)).body;
      assert.equal(rep.notRanked, true);
      const out: string[] = [];
      for (let i = 0; i < 3; i++) {
        const row = rep.reviewers.find((x: any) => x.reviewerId === rvId[i]), b0 = base(rvId[i]);
        assert.ok(row, `reviewer ${i} listed`);
        assert.equal(row.decisions - b0.decisions, exp[i].decisions, `decisions ${i}`); assert.equal(row.approved - b0.approved, exp[i].approved, `approved ${i}`);
        assert.equal(row.sentBack - b0.sentBack, exp[i].sentBack, `sent back ${i}`); assert.equal(row.released - b0.released, exp[i].released, `released ${i}`);
        near((row.handlingHours - b0.handlingHours) * 3600, exp[i].secs, 40, `handling seconds ${i}`);
        const mine = (await G(`/review/cases/my-stats?month=${month}`, rv[i].accessToken)).body;
        assert.equal(mine.decisions, row.decisions); assert.equal(mine.approved, row.approved); assert.equal(mine.handlingHours, row.handlingHours); assert.equal(mine.sentBack, row.sentBack); assert.equal(mine.released, row.released);
        out.push(`reviewer ${'ABC'[i]}: ${exp[i].decisions} decided (${exp[i].approved} approved), ${exp[i].sentBack} sent back, ${exp[i].released} released, ${(exp[i].secs / 3600).toFixed(2)} h`);
      }
      assert.ok(!JSON.stringify(rep).includes('S6f'), 'no case contents in the report');
      return out.join('; ');
    });

    await check('Queue report: decided, approved, rejected, returned and handling time match the independent count', async () => {
      const q1 = (await G(`/admin/reports/queue?month=${month}`)).body.tiers.t1;
      assert.equal(q1.decided - q0.decided, decidedNew); assert.equal(q1.approved - q0.approved, approvedNew); assert.equal(q1.rejected - q0.rejected, rejectedNew);
      assert.equal(q1.returnedForChanges - q0.returnedForChanges, returnedNew);
      assert.equal(q1.received - q0.received, names.length);
      // the queue as it stands: direct count
      const waiting = Number((await h.pool.query(`SELECT count(*)::int n FROM verification.cases WHERE tier='t1' AND status='submitted'`)).rows[0].n);
      assert.equal(q1.queueNow.waiting, waiting);
      return `received +${names.length}, decided +${decidedNew} (${approvedNew} approved, ${rejectedNew} rejected), ${returnedNew} returned; waiting now ${waiting}`;
    });

    await check('Cost report: reviewer cost = handling hours x rate; per-case figure follows; the KES 500 line is shown per tier', async () => {
      const r = (await G(`/admin/reports/cost?month=${month}`)).body, c1 = r.tiers.t1;
      near((c1.handlingHours - c0.handlingHours) * 3600, secsNew, 60, 'handling seconds in the cost report');
      near(c1.reviewerCostKes, c1.handlingHours * c1.reviewerRate.kesPerHour, c1.reviewerRate.kesPerHour * 0.005 + 0.02, 'reviewer cost (hours are shown to 2 decimals, cost is from exact seconds)');
      near(c1.totalCostKes, c1.reviewerCostKes + c1.otherCostsKes + c1.sharedCostsAllocatedKes, 0.02, 'total');
      near(c1.costPerDecidedCase.kes, c1.totalCostKes / c1.decided, 0.02, 'per decided case');
      assert.equal(c1.costPerDecidedCase.withinTarget, c1.totalCostKes / c1.decided <= 500);
      assert.equal(r.targetKes, 500); assert.ok(r.tiers.t2, 'T2 shown separately');
      assert.ok(r.notAPayBasis.includes('must not be used to pay or rank'));
      return `rate KES ${c1.reviewerRate.kesPerHour}/h (${c1.reviewerRate.source}); T1 per decided case KES ${c1.costPerDecidedCase.kes}`;
    });

    await check('Admin only: reports, cost inputs, alerts, rules and stale claims refuse every other account', async () => {
      const paths = ['/admin/reports/queue', '/admin/reports/cost', '/admin/reports/reviewers', '/admin/cost-inputs', '/admin/integrity/alerts', '/admin/integrity/rules', '/admin/review/stale-claims'];
      for (const p of paths) {
        for (const who of [rv[0], plain, mgr]) assert.equal((await G(p, who.accessToken)).status, 403, `${p} for a non-admin`);
        assert.equal((await h.call('GET', p)).status, 401, `${p} signed out`);
      }
      assert.equal((await h.call('POST', '/admin/cost-inputs', { period: month, tier: 't1', kind: 'other', amountKes: 1, note: 'x' }, rv[0].accessToken)).status, 403);
      assert.equal((await h.call('POST', `/admin/review/cases/${id.c9}/release`, { reason: 'not an admin' }, rv[1].accessToken)).status, 403);
      assert.equal((await G(`/review/cases/my-stats?month=${month}`, adm.accessToken)).status, 403, 'statistics pages belong to reviewers');
      for (const res of ['admin_report_queue', 'admin_report_cost', 'admin_report_reviewers', 'admin_stale_claims'])
        if (res === 'admin_stale_claims') continue; else assert.ok(Number((await h.pool.query(`SELECT count(*)::int n FROM governance.data_access_log WHERE accessor_id=$1 AND resource=$2`, [adminId, res])).rows[0].n) >= 1, `${res} logged`);
      return `${paths.length} admin screens refuse reviewers, managers and signed-out callers; admin report views are logged`;
    });

    await check('Stale claim: listed after 4 hours, the fresh claim is not; admin releases it with a reason; no auto-release', async () => {
      const list = (await G('/admin/review/stale-claims')).body;
      assert.equal(list.thresholdHours, 4);
      assert.ok(list.claims.some((c: any) => c.id === id.c9 && c.heldMinutes >= 299), 'c9 listed');
      assert.ok(!list.claims.some((c: any) => c.id === id.c10), 'the 10-minute claim is not stale');
      assert.equal((await G('/admin/review/stale-claims')).status, 200);
      assert.equal((await h.pool.query(`SELECT claimed_by FROM verification.cases WHERE id=$1`, [id.c9])).rows[0].claimed_by, rvId[1], 'nothing released on its own');
      assert.equal((await h.call('POST', `/admin/review/cases/${id.c10}/release`, { reason: 'trying a fresh claim' }, adm.accessToken)).status, 409);
      assert.equal((await h.call('POST', `/admin/review/cases/${id.c9}/release`, {}, adm.accessToken)).status, 400, 'a reason is required');
      assert.equal((await h.call('POST', `/admin/review/cases/${id.c9}/release`, { reason: 'Reviewer offline, case waiting' }, adm.accessToken)).status, 200);
      const s = (await h.pool.query(`SELECT reviewer_id, end_reason, handling_seconds FROM verification.review_sessions WHERE case_id=$1`, [id.c9])).rows;
      assert.equal(s.length, 1); assert.equal(s[0].end_reason, 'admin_released'); assert.equal(s[0].reviewer_id, rvId[1]); near(s[0].handling_seconds, 1800, 5, 'capped');
      const a = (await h.pool.query(`SELECT actor_id, metadata FROM governance.audit_events WHERE action='verification.case_admin_released' AND subject_id=$1`, [id.c9])).rows;
      assert.equal(a.length, 1); assert.equal(a[0].actor_id, adminId); assert.equal(a[0].metadata.reason, 'Reviewer offline, case waiting');
      assert.equal((await claim(id.c9, A)).status, 200, 'back in the queue for another reviewer');
      await h.call('POST', `/review/cases/${id.c9}/release`, undefined, A.accessToken);
      exp[1].released++; exp[1].secs += 1800;
      return 'listed at 5 hours, not at 10 minutes; released by the admin with a reason, recorded, and the case is claimable again';
    });

    await check('Alerts are advisory: the scan changes no case, badge or role; reviewers keep working; only an admin handles an alert, never about themselves', async () => {
      const snap = async () => (await h.pool.query(`SELECT
          (SELECT md5(string_agg(id::text || status || coalesce(decided_by::text,'') || coalesce(badge_id::text,''), ',' ORDER BY id)) FROM verification.cases WHERE id = ANY($1)) AS cases,
          (SELECT md5(string_agg(id::text || coalesce(revoked_at::text,''), ',' ORDER BY id)) FROM verification.badges) AS badges,
          (SELECT md5(string_agg(user_id::text || role, ',' ORDER BY user_id, role)) FROM identity.platform_roles) AS roles`, [Object.values(id)])).rows[0];
      const before = await snap();
      const { IntegrityService } = await import('../integrity/integrity.service');
      const scan = await h.app.get(IntegrityService).scan();
      assert.deepEqual(await snap(), before, 'cases, badges and roles untouched by the scan');
      const alerts = (await G('/admin/integrity/alerts')).body;
      const rules = (await G('/admin/integrity/rules')).body;
      const secondLook = (rules.rules ?? rules).filter((x: any) => String(x.code).startsWith('second_look'));
      assert.ok(secondLook.length === 3 && secondLook.every((x: any) => !x.enabled), 'second-look sampling stays off');
      assert.equal((await h.call('PATCH', `/admin/integrity/rules/${secondLook[0].code}`, { enabled: true }, adm.accessToken)).status, 409, 'cannot be switched on');
      for (const who of [A, B, C]) assert.equal((await h.call('GET', '/review/cases/queue', undefined, who.accessToken)).status, 200, 'reviewers can still work');
      const mine = (alerts.alerts ?? alerts).find?.((x: any) => rvId.includes(x.reviewerId));
      if (mine) {
        assert.equal((await h.call('POST', `/admin/integrity/alerts/${mine.id}/handle`, { status: 'dismissed', note: 'reviewer tries it' }, rv[rvId.indexOf(mine.reviewerId)].accessToken)).status, 403);
        assert.equal((await h.call('POST', `/admin/integrity/alerts/${mine.id}/handle`, { status: 'acknowledged', note: 'Reviewed; normal pace for short documents' }, adm.accessToken)).status, 200);
        assert.equal((await snap()).cases, before.cases, 'handling an alert changes no case');
      }
      return `scan ran ${scan.rulesRun} rules, raised ${scan.raised}; no case, badge or role changed; second-look rules off and refused; ${mine ? 'alert about a test reviewer handled by the admin, case data unchanged' : 'no alert was raised about the test reviewers'}`;
    });

    await check('Reviewers see only their own statistics', async () => {
      const mineB = (await G(`/review/cases/my-stats?month=${month}`, B.accessToken)).body;
      assert.ok(!('reviewers' in mineB) && !('reviewerId' in mineB));
      assert.equal(mineB.decisions, (await G(`/admin/reports/reviewers?month=${month}`)).body.reviewers.find((x: any) => x.reviewerId === rvId[1]).decisions);
      return 'the page returns the caller\'s figures only, with no other reviewer and no ranking';
    });

    await check('Outcomes never depend on time: the sent-back case, the rejected cases and the approvals are exactly what the reviewers chose', async () => {
      const st = async (k: string) => (await h.pool.query(`SELECT status FROM verification.cases WHERE id=$1`, [id[k]])).rows[0].status;
      assert.deepEqual(await Promise.all(['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'c10', 'c11', 'c12'].map(st)),
        ['approved', 'approved', 'rejected', 'approved', 'needs_changes', 'approved', 'rejected', 'approved', 'submitted', 'in_review', 'submitted', 'submitted']);
      return 'all twelve cases ended exactly as the human decisions (or lack of them) dictate';
    });

    // ---------- the audit chain ----------
    await check('Audit chain: every link joins to the one before and every hash recomputes', async () => {
      const r = (await h.pool.query(`
        WITH e AS (SELECT id, occurred_at, actor_id, action, subject_type, subject_id, metadata, prev_hash, hash, lag(hash) OVER (ORDER BY id) AS before FROM governance.audit_events)
        SELECT count(*)::int total,
               count(*) FILTER (WHERE id > (SELECT min(id) FROM e) AND prev_hash IS DISTINCT FROM before)::int broken_links,
               count(*) FILTER (WHERE hash IS DISTINCT FROM extensions.digest(coalesce(prev_hash,'\\x'::bytea) || convert_to(occurred_at::text || coalesce(actor_id::text,'') || action || subject_type || subject_id || metadata::text, 'UTF8'), 'sha256'))::int bad_hashes
          FROM e`)).rows[0];
      assert.equal(r.broken_links, 0, 'links'); assert.equal(r.bad_hashes, 0, 'hashes');
      return `${r.total} events checked, 0 broken links, 0 wrong hashes`;
    });
    await check('Append-only: the time record and the audit table refuse edits and deletes', async () => {
      await assert.rejects(h.pool.query(`UPDATE verification.review_sessions SET handling_seconds = 0 WHERE case_id=$1`, [id.c1]), /./);
      await assert.rejects(h.pool.query(`DELETE FROM verification.review_sessions WHERE case_id=$1`, [id.c1]), /./);
      await assert.rejects(h.pool.query(`UPDATE governance.audit_events SET action='x' WHERE id = (SELECT max(id) FROM governance.audit_events)`), /./);
      return 'edits and deletes refused by the database';
    });

    const report = { ranAt: new Date().toISOString(), month, cases: names.length, reviewers: 3, expected: { decided: decidedNew, approved: approvedNew, rejected: rejectedNew, returned: returnedNew, handlingSeconds: Math.round(secsNew), perReviewer: exp }, checks };
    if (process.env.S6F_REPORT) writeFileSync(process.env.S6F_REPORT, JSON.stringify(report, null, 2));
    const failed = checks.filter((c) => !c.ok);
    assert.equal(failed.length, 0, 'failed checks: ' + failed.map((c) => `${c.name} -> ${c.detail}`).join(' | '));
  } finally { await h.close(); }
});
