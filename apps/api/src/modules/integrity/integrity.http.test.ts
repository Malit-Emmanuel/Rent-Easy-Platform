import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { bootApp } from '../../test-utils/http';

const t = process.env.DATABASE_URL ? test : test.skip;
const MIN = 60e3, H = 3600e3;
const CHECK_YES = { code_heard: true, place_matches_address: true, units_shown: true, footage_continuous: true, location_close: true, matches_documents: true };

t('S6c: the daily scan flags the badly behaving reviewer only; alerts are advisory; admin handling and rule settings', async (ctx) => {
  const h = await bootApp();
  try {
    const phone = () => h.newPhone();
    const mkUser = async (role?: string) => {
      const id = randomUUID(); const p = phone();
      await h.pool.query(`INSERT INTO identity.users (id, phone) VALUES ($1,$2)`, [id, p]);
      if (role) await h.pool.query(`INSERT INTO identity.platform_roles (user_id, role) VALUES ($1,$2)`, [id, role]);
      return { id, p };
    };
    const good1 = await mkUser('reviewer'), good2 = await mkUser('reviewer'), bad = await mkUser('reviewer'), harsh = await mkUser('reviewer'), admin = await mkUser('super_admin'), plain = await mkUser();
    const orgs: string[] = [], props: string[] = [];
    for (const n of ['A', 'B', 'C']) {
      const o = randomUUID(), p = randomUUID();
      await h.pool.query(`INSERT INTO identity.organizations (id, name, kind) VALUES ($1,$2,'agency')`, [o, `S6c Org ${n}`]);
      await h.pool.query(`INSERT INTO supply.properties (id, org_id, name, address_text, location) VALUES ($1,$2,$3,'addr',extensions.st_point(36.8,-1.29)::extensions.geography)`, [p, o, `S6c Prop ${n}`]);
      orgs.push(o); props.push(p);
    }
    const submitter = (await mkUser()).id;

    // Fixture rows are written with triggers off (the database rules are tested elsewhere); the checks and keys still apply.
    const fx = await h.pool.connect();
    await fx.query(`SET session_replication_role = replica`);
    const accessLog: [Date, string, string][] = [];
    const cases: Record<string, string[]> = { good1: [], good2: [], bad: [], harsh: [] };
    const badgeOf: Record<string, string> = {};
    const add = async (who: { id: string }, key: string, o: { org: number; status: 'approved' | 'rejected'; at: Date; openedBefore: number; tier?: 't1' | 't2'; flags?: string[]; appealOf?: string }) => {
      const id = randomUUID(); let badge: string | null = null;
      if (o.status === 'approved') {
        badge = randomUUID();
        await fx.query(`INSERT INTO verification.badges (id, subject_type, subject_id, level, verified_by, issued_at, expires_at) VALUES ($1,'property',$2,$3,$4,$5,$6)`,
          [badge, props[o.org], o.tier === 't2' ? 't2_video' : 't1_documented', who.id, o.at, new Date(o.at.getTime() + 180 * 24 * H)]);
        badgeOf[id] = badge;
      }
      await fx.query(
        `INSERT INTO verification.cases (id, org_id, property_id, tier, status, submitted_by, submitted_at, due_at, decided_by, decided_at, reason_code, badge_id, risk_flags, t2_checklist, appeal_of)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [id, orgs[o.org], props[o.org], o.tier ?? 't1', o.status, submitter, new Date(o.at.getTime() - 2 * H), new Date(o.at.getTime() + 24 * H), who.id, o.at, o.status === 'rejected' ? 'doc_expired' : null, badge,
         o.flags ?? [], o.tier === 't2' ? JSON.stringify(CHECK_YES) : null, o.appealOf ?? null]);
      accessLog.push([new Date(o.at.getTime() - o.openedBefore), who.id, `case ${id} file ${randomUUID()}`]);
      cases[key].push(id);
      return id;
    };
    const now = Date.now();
    // good1: 24 decisions, half approved, spread over three organisations, a slow and steady pace, documents opened 10 minutes before deciding
    for (let i = 0; i < 24; i++) await add(good1, 'good1', { org: i % 3, status: i % 2 ? 'approved' : 'rejected', at: new Date(now - (i + 2) * H), openedBefore: 10 * MIN });
    // good2: 22 decisions, half approved
    for (let i = 0; i < 22; i++) await add(good2, 'good2', { org: (i + 1) % 3, status: i % 2 ? 'approved' : 'rejected', at: new Date(now - (i + 2) * H - 30 * MIN), openedBefore: 8 * MIN });
    // bad: 25 approvals in about 8 minutes, 24 for one organisation, 10 seconds after opening, 3 flagged, 20 of them T2 with every answer yes
    for (let i = 0; i < 25; i++) await add(bad, 'bad', { org: i === 24 ? 1 : 0, status: 'approved', at: new Date(now - 90 * MIN + i * 20e3), openedBefore: 10e3, tier: i < 20 ? 't2' : 't1', flags: i < 3 ? ['video_reused'] : [] });
    // harsh: 6 rejections, all appealed to good2, 4 overturned
    for (let i = 0; i < 6; i++) {
      const orig = await add(harsh, 'harsh', { org: i % 3, status: 'rejected', at: new Date(now - (10 + i) * 24 * H), openedBefore: 5 * MIN });
      await add(good2, 'good2', { org: i % 3, status: i < 4 ? 'approved' : 'rejected', at: new Date(now - (9 + i) * 24 * H), openedBefore: 5 * MIN, appealOf: orig });
    }
    for (const [at, who, reason] of accessLog) await fx.query(`INSERT INTO governance.data_access_log (accessed_at, accessor_id, resource, reason) VALUES ($1,$2,'file:document',$3)`, [at, who, reason]);
    // a stale claim held by "bad" for six hours
    const staleId = randomUUID();
    await fx.query(`INSERT INTO verification.cases (id, org_id, property_id, status, submitted_by, submitted_at, due_at, claimed_by, claimed_at) VALUES ($1,$2,$3,'in_review',$4,$5,$6,$7,$8)`,
      [staleId, orgs[2], props[2], submitter, new Date(now - 8 * H), new Date(now + 24 * H), bad.id, new Date(now - 6 * H)]);
    await fx.query(`SET session_replication_role = DEFAULT`); fx.release();
    // 12 of bad's approvals were later withdrawn by a different reviewer (good1); and bad tried to claim a case from their own organisation
    for (const id of cases.bad.slice(5, 17)) await h.pool.query(`INSERT INTO governance.audit_events (actor_id, action, subject_type, subject_id, metadata) VALUES ($1,'verification.badge_revoked','badge',$2,'{}')`, [good1.id, badgeOf[id]]);
    await h.pool.query(`INSERT INTO governance.audit_events (actor_id, action, subject_type, subject_id) VALUES ($1,'verification.own_org_claim_refused','verification_case',$2)`, [bad.id, cases.good1[0]]);
    // an automatic withdrawal (nobody acted) and a self-correction must not count
    await h.pool.query(`INSERT INTO governance.audit_events (actor_id, action, subject_type, subject_id, metadata) VALUES (NULL,'verification.badge_revoked','badge',$1,'{}')`, [badgeOf[cases.bad[20]]]);
    await h.pool.query(`INSERT INTO governance.audit_events (actor_id, action, subject_type, subject_id, metadata) VALUES ($1,'verification.badge_revoked','badge',$2,'{}')`, [bad.id, badgeOf[cases.bad[21]]]);

    const statusCounts = async () => JSON.stringify((await h.pool.query(`SELECT status, count(*)::int n FROM verification.cases GROUP BY 1 ORDER BY 1`)).rows);
    const casesBefore = await statusCounts();
    const rolesBefore = (await h.pool.query(`SELECT count(*)::int n FROM identity.platform_roles`)).rows[0].n;
    const mine = [good1.id, good2.id, bad.id, harsh.id];
    const alertsOf = async (id: string) => (await h.pool.query(`SELECT rule_code FROM verification.integrity_alerts WHERE reviewer_id=$1 ORDER BY rule_code`, [id])).rows.map((r: any) => r.rule_code);
    const { IntegrityService } = await import('./integrity.service');
    const svc = h.app.get(IntegrityService);

    await ctx.test('the scan raises the right alerts for the bad reviewer and none for the good ones', async () => {
      const r = await svc.scan();
      assert.ok(r.rulesRun >= 10 && r.raised >= 9, JSON.stringify(r));
      assert.deepEqual(await alertsOf(bad.id), ['approval_rate_high', 'approvals_withdrawn', 'burst', 'flagged_approved', 'org_concentration', 'own_org_attempt', 'stale_claim', 'too_fast', 'uniform_checklist']);
      assert.deepEqual(await alertsOf(good1.id), []);
      assert.deepEqual(await alertsOf(good2.id), []);
      assert.deepEqual(await alertsOf(harsh.id), ['appeals_overturned']);
    });

    await ctx.test('figures are right, withdrawals count only another reviewer\'s action', async () => {
      const fig = async (rule: string, who = bad.id) => (await h.pool.query(`SELECT figures, case_ids FROM verification.integrity_alerts WHERE rule_code=$1 AND reviewer_id=$2`, [rule, who])).rows[0];
      assert.equal(fig('approvals_withdrawn') && (await fig('approvals_withdrawn')).figures.withdrawn, 12);
      assert.equal((await fig('approval_rate_high')).figures.approvalRatePct, 100);
      assert.ok((await fig('approval_rate_high')).figures.differencePoints >= 25);
      assert.ok((await fig('too_fast')).figures.medianSeconds <= 10.5);
      assert.equal((await fig('org_concentration')).figures.topOrganisationApprovals, 24);
      assert.equal((await fig('burst')).figures.decisionsInWindow, 25);
      assert.equal((await fig('flagged_approved')).figures.flaggedApprovals, 3);
      assert.deepEqual(new Set((await fig('flagged_approved')).case_ids), new Set(cases.bad.slice(0, 3)));
      assert.equal((await fig('uniform_checklist')).figures.allYesPct, 100);
      assert.deepEqual((await fig('stale_claim')).case_ids, [staleId]);
      assert.equal((await fig('appeals_overturned', harsh.id)).figures.overturned, 4);
    });

    await ctx.test('scanning again raises nothing new; alerts change no case and no role', async () => {
      const again = await svc.scan();
      assert.equal(again.raised, 0);
      assert.equal(await statusCounts(), casesBefore);
      assert.equal((await h.pool.query(`SELECT count(*)::int n FROM identity.platform_roles`)).rows[0].n, rolesBefore);
      assert.equal((await h.pool.query(`SELECT status FROM verification.cases WHERE id=$1`, [staleId])).rows[0].status, 'in_review', 'the stale claim is flagged, not released');
    });

    await ctx.test('a rule does not fire below its minimum sample', async () => {
      // harsh has 6 decisions: no approval-rate, speed or burst alert even though 0% approvals / quick pace would otherwise stand out
      assert.ok(!(await alertsOf(harsh.id)).some((c) => c !== 'appeals_overturned'));
    });

    const adm = await h.login(admin.p), pl = await h.login(plain.p), rv = await h.login(good1.p);

    await ctx.test('only an admin can see or handle alerts and rules', async () => {
      for (const who of [pl, rv]) {
        assert.equal((await h.call('GET', '/admin/integrity/alerts', undefined, who.accessToken)).status, 403);
        assert.equal((await h.call('GET', '/admin/integrity/rules', undefined, who.accessToken)).status, 403);
        assert.equal((await h.call('PATCH', '/admin/integrity/rules/burst', { threshold: 99 }, who.accessToken)).status, 403);
      }
      assert.equal((await h.call('GET', '/admin/integrity/alerts')).status, 401);
    });

    let tooFast = '', staleAlert = '';
    await ctx.test('the admin sees rule, figures and case numbers, never contents; the view is logged', async () => {
      const r = await h.call('GET', '/admin/integrity/alerts', undefined, adm.accessToken);
      assert.equal(r.status, 200);
      const mineAlerts = (r.body as any[]).filter((a) => mine.includes(a.reviewerId));
      assert.equal(mineAlerts.length, 10);
      assert.ok(mineAlerts.every((a) => a.advisory === true && a.status === 'open'));
      const text = JSON.stringify(mineAlerts);
      assert.ok(!text.includes('S6c Prop') && !text.includes('addr'), 'no property details');
      tooFast = mineAlerts.find((a) => a.rule === 'too_fast' && a.reviewerId === bad.id).id;
      staleAlert = mineAlerts.find((a) => a.rule === 'stale_claim').id;
      assert.ok((await h.pool.query(`SELECT count(*)::int n FROM governance.data_access_log WHERE accessor_id=$1 AND resource='admin_integrity_alerts'`, [admin.id])).rows[0].n >= 1);
    });

    await ctx.test('handling needs a note and a valid status; escalate, then close; a closed alert cannot be reopened', async () => {
      assert.equal((await h.call('POST', `/admin/integrity/alerts/${tooFast}/handle`, { status: 'dismissed' }, adm.accessToken)).status, 400);
      assert.equal((await h.call('POST', `/admin/integrity/alerts/${tooFast}/handle`, { status: 'banned', note: 'not a status' }, adm.accessToken)).status, 400);
      assert.equal((await h.call('POST', `/admin/integrity/alerts/${randomUUID()}/handle`, { status: 'dismissed', note: 'no such alert' }, adm.accessToken)).status, 404);
      assert.equal((await h.call('POST', `/admin/integrity/alerts/${tooFast}/handle`, { status: 'escalated', note: 'Asking the reviewer why' }, adm.accessToken)).status, 200);
      assert.equal((await h.call('POST', `/admin/integrity/alerts/${tooFast}/handle`, { status: 'dismissed', note: 'Explained: short documents' }, adm.accessToken)).status, 200);
      assert.equal((await h.call('POST', `/admin/integrity/alerts/${tooFast}/handle`, { status: 'acknowledged', note: 'trying to reopen it' }, adm.accessToken)).status, 409);
      const a = (await h.pool.query(`SELECT status, handled_by, handler_note FROM verification.integrity_alerts WHERE id=$1`, [tooFast])).rows[0];
      assert.equal(a.status, 'dismissed'); assert.equal(a.handled_by, admin.id); assert.equal(a.handler_note, 'Explained: short documents');
      assert.equal((await h.pool.query(`SELECT count(*)::int n FROM governance.audit_events WHERE subject_id=$1 AND action LIKE 'integrity.alert_%'`, [tooFast])).rows[0].n, 3);   // raised, escalated, dismissed
      assert.equal((await h.pool.query(`SELECT status FROM verification.cases WHERE id=$1`, [staleId])).rows[0].status, 'in_review');
    });

    await ctx.test('a dismissed alert is not re-raised the next day (cooldown), and a held stale claim is not duplicated', async () => {
      assert.equal((await svc.scan()).raised, 0);
      assert.equal((await h.pool.query(`SELECT count(*)::int n FROM verification.integrity_alerts WHERE rule_code='too_fast' AND reviewer_id=$1`, [bad.id])).rows[0].n, 1);
    });

    await ctx.test('rules can be adjusted by the admin, with checks; every change is in the audit trail', async () => {
      const rules = (await h.call('GET', '/admin/integrity/rules', undefined, adm.accessToken)).body as any[];
      assert.equal(rules.length, 13);
      assert.equal(rules.find((r) => r.code === 'stale_claim').threshold, 4);
      assert.equal(rules.find((r) => r.code === 'second_look_disagree').available, false);
      const before = (await h.pool.query(`SELECT count(*)::int n FROM governance.audit_events WHERE action='integrity.rule_changed'`)).rows[0].n;
      assert.equal((await h.call('PATCH', '/admin/integrity/rules/burst', { threshold: 20, minSample: 20 }, adm.accessToken)).status, 200);
      assert.equal((await h.pool.query(`SELECT count(*)::int n FROM governance.audit_events WHERE action='integrity.rule_changed'`)).rows[0].n, before + 1);
      assert.equal((await h.pool.query(`SELECT threshold::int t, updated_by FROM verification.integrity_rules WHERE code='burst'`)).rows[0].updated_by, admin.id);
      assert.equal((await h.call('PATCH', '/admin/integrity/rules/burst', { threshold: 'lots' }, adm.accessToken)).status, 400);
      assert.equal((await h.call('PATCH', '/admin/integrity/rules/burst', { threshold: -1 }, adm.accessToken)).status, 400);
      assert.equal((await h.call('PATCH', '/admin/integrity/rules/burst', {}, adm.accessToken)).status, 400);
      assert.equal((await h.call('PATCH', '/admin/integrity/rules/nothing', { threshold: 1 }, adm.accessToken)).status, 404);
      assert.equal((await h.call('PATCH', '/admin/integrity/rules/second_look_disagree', { enabled: true }, adm.accessToken)).status, 409);
      await h.call('PATCH', '/admin/integrity/rules/burst', { threshold: 15, minSample: 15 }, adm.accessToken);   // put it back
    });

    await ctx.test('a switched-off rule is not run', async () => {
      await h.call('PATCH', '/admin/integrity/rules/flagged_approved', { enabled: false }, adm.accessToken);
      const live = (await h.pool.query(`SELECT count(*)::int n FROM verification.integrity_rules WHERE enabled`)).rows[0].n;
      assert.equal((await svc.scan()).rulesRun, live);
      await h.call('PATCH', '/admin/integrity/rules/flagged_approved', { enabled: true }, adm.accessToken);
    });

    await ctx.test('the daily job is registered and returns counts only', async () => {
      const { JobsService } = await import('../jobs/jobs.service');
      const jobs = h.app.get(JobsService);
      assert.ok(jobs.schedules.some((x: any) => x.name === 'integrity-scan' && x.everyMs === 24 * 60 * 60 * 1000));
      const out: any = await jobs.handlers['integrity-scan']();
      assert.deepEqual(Object.keys(out).sort(), ['raised', 'rulesRun', 'skipped']);
    });
  } finally { await h.close(); }
});
