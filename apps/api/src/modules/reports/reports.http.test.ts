import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { bootApp } from '../../test-utils/http';

const t = process.env.DATABASE_URL ? test : test.skip;
const H = 3600e3, MIN = 60e3;
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const r1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);
const r2 = (v: number) => Math.round(v * 100) / 100;
const CHECK_YES = { code_heard: true, place_matches_address: true, units_shown: true, footage_continuous: true, location_close: true, matches_documents: true };

interface C { key: string; tier: 't1' | 't2'; status: string; sub: Date; dec?: Date; due: Date; appealOf?: string; units: number; sessions: { claim: Date; end: Date; secs: number; reason: string }[]; returned?: Date }

t('S6d: queue, cost and reviewer reports match independent counts; cost inputs; admin only; logged', async (ctx) => {
  const h = await bootApp();
  try {
    // A month nobody has used, so the expected figures are exactly the fixture below.
    let year = 2024, mon = 1;
    for (let tries = 0; tries < 60; tries++) {
      year = 2024 + Math.floor(Math.random() * 2); mon = 1 + Math.floor(Math.random() * 12);
      const s = new Date(Date.UTC(year, mon - 1, 1) - 3 * H).toISOString(), e = new Date(Date.UTC(year, mon, 1) - 3 * H).toISOString();
      const used = (await h.pool.query(`SELECT (SELECT count(*) FROM verification.cases WHERE (submitted_at >= $1 AND submitted_at < $2) OR (decided_at >= $1 AND decided_at < $2)) + (SELECT count(*) FROM verification.review_sessions WHERE ended_at >= $1 AND ended_at < $2)
          + (SELECT count(*) FROM verification.cost_inputs WHERE period = $3::date AND kind <> 'reviewer_rate_per_hour') AS n`, [s, e, `${year}-${String(mon).padStart(2, '0')}-01`])).rows[0].n;
      if (Number(used) === 0) break;
    }
    const month = `${year}-${String(mon).padStart(2, '0')}`;
    const base = Date.UTC(year, mon - 1, 1) - 3 * H;                       // midnight at the start of the month, Nairobi
    const D = (day: number, hour = 9) => new Date(base + (day - 1) * 24 * H + hour * H);
    const before = new Date(base - 6 * 24 * H), after = new Date(base + 31 * 24 * H);

    const mkUser = async (role?: string) => { const id = randomUUID(), p = h.newPhone(); await h.pool.query(`INSERT INTO identity.users (id, phone) VALUES ($1,$2)`, [id, p]); if (role) await h.pool.query(`INSERT INTO identity.platform_roles (user_id, role) VALUES ($1,$2)`, [id, role]); return { id, p }; };
    const rvA = await mkUser('reviewer'), rvB = await mkUser('reviewer'), admin = await mkUser('super_admin'), plain = await mkUser(), sub = await mkUser();
    const org = randomUUID();
    await h.pool.query(`INSERT INTO identity.organizations (id, name, kind) VALUES ($1,'S6d Org','agency')`, [org]);

    const cs: C[] = [];
    const add = (c: Omit<C, 'sessions'> & { sessions?: C['sessions'] }) => cs.push({ sessions: [], ...c });
    const sess = (c: { sub: Date }, waitMin: number, secs: number, end: Date, reason = 'decided') => ({ claim: new Date(c.sub.getTime() + waitMin * MIN), end, secs, reason });
    // T1: a-c on time, d-f late, g-h rejected (g on time, h late); k decided at 00:30 on the 1st (inside the month, Nairobi), l decided at 00:30 on the 1st of next month (outside)
    const T1 = [['a', 'approved', 5, 7, 600, 10], ['b', 'approved', 5, 7, 900, 20], ['c', 'approved', 5, 8, 1200, 30], ['d', 'approved', 5, 12, 1500, 40], ['e', 'approved', 5, 12, 1800, 50], ['f', 'approved', 5, 13, 300, 60], ['g', 'rejected', 5, 9, 450, 70], ['h', 'rejected', 5, 14, 2400, 80]] as const;
    T1.forEach(([k, st, sd, dd, secs, wait], i) => {
      const c = { key: k, tier: 't1' as const, status: st, sub: D(sd), dec: D(dd), due: D(sd + 6), units: st === 'approved' ? (i % 3) + 1 : 0 };
      add({ ...c, sessions: [sess(c, wait, secs, c.dec)] });
    });
    { const c = { key: 'k', tier: 't1' as const, status: 'approved', sub: new Date(base - 3 * 24 * H), dec: new Date(base + 30 * MIN), due: new Date(base + 24 * H), units: 2 }; add({ ...c, sessions: [sess(c, 5, 100, c.dec)] }); }
    { const c = { key: 'l', tier: 't1' as const, status: 'approved', sub: D(28), dec: new Date(base + 30 * 24 * H + 24 * H + 30 * MIN), due: after, units: 5 }; add({ ...c, sessions: [sess(c, 5, 100, c.dec)] }); }
    // appeals of g (overturned) and h (upheld), decided in time
    { const c = { key: 'ag', tier: 't1' as const, status: 'approved', sub: D(15), dec: D(18), due: D(22), appealOf: 'g', units: 3 }; add({ ...c, sessions: [sess(c, 5, 1000, c.dec)] }); }
    { const c = { key: 'ah', tier: 't1' as const, status: 'rejected', sub: D(15), dec: D(18), due: D(22), appealOf: 'h', units: 0 }; add({ ...c, sessions: [sess(c, 5, 500, c.dec)] }); }
    // one returned for changes (with a time record for the stretch), one still waiting and overdue
    { const c = { key: 'j', tier: 't1' as const, status: 'needs_changes', sub: D(6), due: D(12), units: 0, returned: D(10) }; add({ ...c, sessions: [sess(c, 15, 200, D(10), 'sent_back')] }); }
    add({ key: 'i', tier: 't1', status: 'submitted', sub: D(7), due: D(11), units: 0 });
    // T2: three approved (one without a time record), one rejected
    [['u1', 'approved', 1200, 30], ['u2', 'approved', 1800, 45], ['u3', 'approved', 0, 0], ['u4', 'rejected', 600, 15]].forEach(([k, st, secs, wait], i) => {
      const c = { key: k as string, tier: 't2' as const, status: st as string, sub: D(6), dec: D(8 + i), due: D(16), units: st === 'approved' ? 2 : 0 };
      add({ ...c, sessions: secs ? [sess(c, wait as number, secs as number, c.dec)] : [] });
    });

    const fx = await h.pool.connect(); await fx.query(`SET session_replication_role = replica`);
    const ids: Record<string, string> = {}, props: Record<string, string> = {};
    for (const c of cs) { ids[c.key] = randomUUID(); props[c.key] = randomUUID(); }
    for (const c of cs) {
      const p = c.appealOf ? props[c.appealOf] : props[c.key];
      if (!c.appealOf) {
        await fx.query(`INSERT INTO supply.properties (id, org_id, name, address_text, location) VALUES ($1,$2,$3,'addr',extensions.st_point(36.8,-1.29)::extensions.geography)`, [p, org, `S6d ${c.key}`]);
        for (let u = 0; u < c.units; u++) await fx.query(`INSERT INTO supply.units (property_id, label, bedrooms) VALUES ($1,$2,1)`, [p, `U${u}`]);
      }
    }
    for (const c of cs) {
      const p = c.appealOf ? props[c.appealOf] : props[c.key];
      let badge: string | null = null;
      if (c.status === 'approved') { badge = randomUUID(); await fx.query(`INSERT INTO verification.badges (id, subject_type, subject_id, level, issued_at, expires_at) VALUES ($1,'property',$2,$3,$4,$5)`, [badge, p, c.tier === 't2' ? 't2_video' : 't1_documented', c.dec, new Date(c.dec!.getTime() + 100 * 24 * H)]); }
      const by = c.status === 'approved' || c.status === 'rejected' ? (c.appealOf ? rvB.id : rvA.id) : null;
      await fx.query(
        `INSERT INTO verification.cases (id, org_id, property_id, tier, status, submitted_by, submitted_at, due_at, decided_by, decided_at, reason_code, badge_id, appeal_of, t2_checklist, paused_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [ids[c.key], org, p, c.tier, c.status, sub.id, c.sub, c.due, by, c.dec ?? null, c.status === 'rejected' || c.status === 'needs_changes' ? 'doc_expired' : null, badge, c.appealOf ? ids[c.appealOf] : null, c.tier === 't2' && c.status === 'approved' ? JSON.stringify(CHECK_YES) : null, c.status === 'needs_changes' ? c.returned : null]);
    }
    for (const c of cs) for (const s of c.sessions) {
      await fx.query(`INSERT INTO verification.review_sessions (case_id, reviewer_id, claimed_at, ended_at, end_reason, elapsed_seconds, handling_seconds, opens) VALUES ($1,$2,$3,$4,$5,$6,$7,0)`,
        [ids[c.key], c.appealOf ? rvB.id : rvA.id, s.claim, s.end, s.reason, Math.floor((s.end.getTime() - s.claim.getTime()) / 1000), s.secs]);
    }
    await fx.query(`SET session_replication_role = DEFAULT`); fx.release();
    for (const c of cs.filter((x) => x.returned)) await h.pool.query(`INSERT INTO governance.audit_events (occurred_at, actor_id, action, subject_type, subject_id) VALUES ($1,$2,'verification.needs_changes','verification_case',$3)`, [c.returned, rvA.id, ids[c.key]]);
    // one reviewer alert raised in the month
    await h.pool.query(`INSERT INTO verification.integrity_alerts (rule_code, reviewer_id, raised_at) VALUES ('burst',$1,$2)`, [rvA.id, D(20)]);

    const adm = await h.login(admin.p), pl = await h.login(plain.p), rev = await h.login(rvA.p);
    const G = (path: string, tok = adm.accessToken) => h.call('GET', path, undefined, tok);

    // ----- independent expectations, worked out from the fixture alone -----
    const inMonth = (d?: Date) => !!d && d.getTime() >= base && d.getTime() < base + (new Date(Date.UTC(year, mon, 1)).getTime() - new Date(Date.UTC(year, mon - 1, 1)).getTime());
    const tierCases = (tier: string) => cs.filter((c) => c.tier === tier);
    const decidedIn = (tier: string) => tierCases(tier).filter((c) => (c.status === 'approved' || c.status === 'rejected') && inMonth(c.dec));
    const sessionsIn = (tier: string) => tierCases(tier).flatMap((c) => c.sessions.filter((s) => inMonth(s.end)).map((s) => ({ c, s })));
    const perCaseSecs = (tier: string) => { const m = new Map<string, number>(); for (const { c, s } of sessionsIn(tier)) m.set(c.key, (m.get(c.key) ?? 0) + s.secs); return [...m.values()]; };

    await ctx.test('only an admin can open the reports and the cost inputs', async () => {
      for (const path of ['/admin/reports/queue', '/admin/reports/cost', '/admin/reports/reviewers', '/admin/cost-inputs']) {
        assert.equal((await G(path, pl.accessToken)).status, 403, path);
        assert.equal((await G(path, rev.accessToken)).status, 403, path);
        assert.equal((await h.call('GET', path)).status, 401, path);
      }
      assert.equal((await h.call('POST', '/admin/cost-inputs', { period: month, tier: 't1', kind: 'other', amountKes: 1, note: 'x' }, rev.accessToken)).status, 403);
    });

    await ctx.test('queue report: every figure matches the independent count', async () => {
      const r = await G(`/admin/reports/queue?month=${month}`);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      for (const tier of ['t1', 't2'] as const) {
        const got = r.body.tiers[tier], dec = decidedIn(tier);
        assert.equal(got.received, tierCases(tier).filter((c) => !c.appealOf && inMonth(c.sub)).length, `${tier} received`);
        assert.equal(got.decided, dec.length, `${tier} decided`);
        assert.equal(got.approved, dec.filter((c) => c.status === 'approved').length);
        assert.equal(got.rejected, dec.filter((c) => c.status === 'rejected').length);
        assert.equal(got.onTimePct.value, dec.length ? r1(100 * dec.filter((c) => c.dec!.getTime() <= c.due.getTime()).length / dec.length) : null, `${tier} on time`);
        assert.equal(got.deadlineBreaches.decidedLate, dec.filter((c) => c.dec!.getTime() > c.due.getTime()).length);
        assert.equal(got.returnedForChanges, tierCases(tier).filter((c) => c.returned && inMonth(c.returned)).length);
        const hs = perCaseSecs(tier);
        assert.equal(got.medianHandlingMinutes.sampleSize, hs.length); assert.equal(got.medianHandlingMinutes.value, r1(median(hs.map((x) => x / 60))));
        const waits = tierCases(tier).filter((c) => c.sessions.length && inMonth(new Date(Math.min(...c.sessions.map((s) => s.claim.getTime()))))).map((c) => (Math.min(...c.sessions.map((s) => s.claim.getTime())) - c.sub.getTime()) / MIN);
        assert.equal(got.medianWaitMinutes.sampleSize, waits.length); assert.equal(got.medianWaitMinutes.value, r1(median(waits)));
        const ap = tierCases(tier).filter((c) => c.appealOf);
        assert.deepEqual(got.appeals, { filed: ap.filter((c) => inMonth(c.sub)).length, decided: ap.filter((c) => inMonth(c.dec)).length, overturned: ap.filter((c) => c.status === 'approved' && inMonth(c.dec)).length });
      }
      assert.equal(r.body.tiers.t1.appeals.overturned, 1);
      assert.equal(r.body.tiers.t1.decided, 11, 'the 00:30 decision on the 1st is in, the 00:30 on the next 1st is out');
    });

    await ctx.test('queue now: matches a direct count, age bands add up, the overdue waiting case is counted', async () => {
      const r = await G(`/admin/reports/queue?month=${month}`);
      for (const tier of ['t1', 't2']) {
        const q = r.body.tiers[tier].queueNow;
        const n = async (cond: string) => Number((await h.pool.query(`SELECT count(*)::int n FROM verification.cases WHERE tier=$1 AND ${cond}`, [tier])).rows[0].n);
        assert.equal(q.waiting, await n(`status='submitted'`)); assert.equal(q.inReview, await n(`status='in_review'`)); assert.equal(q.needsChanges, await n(`status='needs_changes'`));
        assert.equal(r.body.tiers[tier].deadlineBreaches.overdueNow, await n(`status IN ('submitted','in_review') AND due_at < now()`));
        const b = q.waitingByAge; assert.equal(b.under1Day + b.days1to2 + b.days2to3 + b.over3Days, q.waiting);
      }
      assert.ok(r.body.tiers.t1.deadlineBreaches.overdueNow >= 1);
    });

    await ctx.test('cost inputs: validated, append-only, audited; the latest entry wins', async () => {
      const post = (b: any) => h.call('POST', '/admin/cost-inputs', b, adm.accessToken);
      assert.equal((await post({ period: month, tier: 'all', kind: 'reviewer_rate_per_hour', amountKes: 600, note: 'placeholder agreed' })).status, 201);
      assert.equal((await post({ period: month, tier: 'all', kind: 'reviewer_rate_per_hour', amountKes: 750, note: 'real rate' })).status, 201);
      assert.equal((await post({ period: month, tier: 't1', kind: 'identity_check_fees', amountKes: 3000 })).status, 201);
      assert.equal((await post({ period: month, tier: 'all', kind: 'other', amountKes: 1000, note: 'shared tooling' })).status, 201);
      for (const bad of [{ period: '2026-13', tier: 't1', kind: 'other', amountKes: 1, note: 'x' }, { period: month, tier: 'x', kind: 'other', amountKes: 1, note: 'x' }, { period: month, tier: 't1', kind: 'salary', amountKes: 1 },
        { period: month, tier: 't1', kind: 'field_visits', amountKes: -5 }, { period: month, tier: 't1', kind: 'field_visits', amountKes: '5' }, { period: month, tier: 't1', kind: 'other', amountKes: 5 }, {}])
        assert.equal((await post(bad)).status, 400, JSON.stringify(bad));
      const list = (await G(`/admin/cost-inputs?month=${month}`)).body;
      assert.equal(list.inputs.length, 4); assert.equal(list.inputs[0].kind, 'other'); assert.equal(list.placeholderRateKes, 600);
      assert.equal((await h.pool.query(`SELECT count(*)::int n FROM governance.audit_events WHERE action='cost.input_recorded' AND actor_id=$1`, [admin.id])).rows[0].n, 4);
    });

    await ctx.test('cost report: reviewer cost, shared costs, per-case and per-unit figures match the independent calculation', async () => {
      const r = await G(`/admin/reports/cost?month=${month}`);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      const totalDecided = decidedIn('t1').length + decidedIn('t2').length;
      for (const tier of ['t1', 't2'] as const) {
        const got = r.body.tiers[tier];
        const hours = sessionsIn(tier).reduce((a, x) => a + x.s.secs, 0) / 3600;
        const reviewer = hours * 750, direct = tier === 't1' ? 3000 : 0, shared = 1000 * decidedIn(tier).length / totalDecided, total = reviewer + direct + shared;
        const approvedProps = new Set(decidedIn(tier).filter((c) => c.status === 'approved').map((c) => (c.appealOf ?? c.key)));
        const units = cs.filter((c) => approvedProps.has(c.key) && !c.appealOf).reduce((a, c) => a + c.units, 0);
        assert.equal(got.handlingHours, r2(hours)); assert.deepEqual(got.reviewerRate, { kesPerHour: 750, source: 'entered', fromMonth: month });
        assert.equal(got.reviewerCostKes, r2(reviewer)); assert.equal(got.otherCostsKes, direct); assert.equal(got.sharedCostsAllocatedKes, r2(shared)); assert.equal(got.totalCostKes, r2(total));
        assert.equal(got.decided, decidedIn(tier).length); assert.equal(got.approved, decidedIn(tier).filter((c) => c.status === 'approved').length);
        assert.equal(got.verifiedUnits, units, `${tier} units`);
        assert.equal(got.costPerDecidedCase.kes, r2(total / decidedIn(tier).length));
        assert.equal(got.costPerApprovedCase.kes, r2(total / got.approved));
        assert.equal(got.costPerVerifiedUnit.kes, units ? r2(total / units) : null);
        assert.equal(got.costPerDecidedCase.withinTarget, total / decidedIn(tier).length <= 500);
        assert.equal(got.decidedWithoutTimeRecord, decidedIn(tier).filter((c) => !c.sessions.length).length);
      }
      assert.equal(r.body.tiers.t2.decidedWithoutTimeRecord, 1);
      assert.equal(r.body.targetKes, 500); assert.ok(r.body.excludes.includes('developer time')); assert.ok(r.body.notAPayBasis.includes('must not be used to pay or rank'));
    });

    await ctx.test('without any entered rate the placeholder is used and labelled', async () => {
      const early = '2024-01';
      const hadRate = Number((await h.pool.query(`SELECT count(*)::int n FROM verification.cost_inputs WHERE kind='reviewer_rate_per_hour' AND period <= '2024-01-01'`)).rows[0].n);
      if (hadRate === 0) { const r = await G(`/admin/reports/cost?month=${early}`); assert.deepEqual(r.body.tiers.t1.reviewerRate, { kesPerHour: 600, source: 'placeholder', fromMonth: null }); }
    });

    await ctx.test('reviewer report: per-account figures match, not ranked, no case contents', async () => {
      const r = await G(`/admin/reports/reviewers?month=${month}`);
      assert.equal(r.status, 200); assert.equal(r.body.notRanked, true);
      const a = r.body.reviewers.find((x: any) => x.reviewerId === rvA.id), b = r.body.reviewers.find((x: any) => x.reviewerId === rvB.id);
      const mine = (id: 'a' | 'b') => cs.filter((c) => (c.status === 'approved' || c.status === 'rejected') && inMonth(c.dec) && (id === 'b') === !!c.appealOf);
      assert.equal(a.decisions, mine('a').length); assert.equal(a.approved, mine('a').filter((c) => c.status === 'approved').length); assert.equal(a.sampleSize, a.decisions);
      assert.equal(a.approvalRatePct, r1(100 * a.approved / a.decisions));
      assert.equal(b.decisions, mine('b').length); assert.equal(b.approved, 1);
      assert.equal(a.sentBack, 1); assert.equal(a.alertsRaised, 1); assert.equal(b.alertsRaised, 0);
      const secsA = cs.filter((c) => !c.appealOf).flatMap((c) => c.sessions).filter((s) => inMonth(s.end)).reduce((x, s) => x + s.secs, 0);
      assert.equal(a.handlingHours, r2(secsA / 3600));
      const ids = r.body.reviewers.map((x: any) => x.reviewerId); assert.deepEqual(ids, [...ids].sort(), 'listed by account, not by performance');
      assert.ok(!JSON.stringify(r.body).includes('S6d'));
    });

    await ctx.test('every admin view is logged, and bad input is refused', async () => {
      for (const res of ['admin_report_queue', 'admin_report_cost', 'admin_report_reviewers', 'admin_cost_inputs'])
        assert.ok(Number((await h.pool.query(`SELECT count(*)::int n FROM governance.data_access_log WHERE accessor_id=$1 AND resource=$2`, [admin.id, res])).rows[0].n) >= 1, res);
      for (const m of ['2026-13', 'november', '2023-01', '2026-1']) assert.equal((await G(`/admin/reports/queue?month=${m}`)).status, 400, m);
      assert.equal((await G('/admin/reports/queue')).status, 200, 'defaults to the current month');
    });

    await ctx.test('reports change nothing', async () => {
      const n = (await h.pool.query(`SELECT count(*)::int n FROM verification.cases WHERE id = ANY($1)`, [Object.values(ids)])).rows[0].n;
      assert.equal(n, cs.length);
      assert.equal((await h.pool.query(`SELECT status FROM verification.cases WHERE id=$1`, [ids.i])).rows[0].status, 'submitted');
    });
  } finally { await h.close(); }
});
