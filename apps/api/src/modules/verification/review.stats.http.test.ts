import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { bootApp } from '../../test-utils/http';

const t = process.env.DATABASE_URL ? test : test.skip;
const H = 3600e3, MIN = 60e3;

t('S6e: a reviewer sees only their own statistics; the admin probe; account labels', async (ctx) => {
  const h = await bootApp();
  try {
    let year = 2024, mon = 1;
    for (let i = 0; i < 60; i++) {
      year = 2024 + Math.floor(Math.random() * 2); mon = 1 + Math.floor(Math.random() * 12);
      const s = new Date(Date.UTC(year, mon - 1, 1) - 3 * H).toISOString(), e = new Date(Date.UTC(year, mon, 1) - 3 * H).toISOString();
      const used = (await h.pool.query(`SELECT (SELECT count(*) FROM verification.cases WHERE decided_at >= $1 AND decided_at < $2) + (SELECT count(*) FROM verification.review_sessions WHERE ended_at >= $1 AND ended_at < $2) n`, [s, e])).rows[0].n;
      if (Number(used) === 0) break;
    }
    const month = `${year}-${String(mon).padStart(2, '0')}`, base = Date.UTC(year, mon - 1, 1) - 3 * H, D = (day: number) => new Date(base + (day - 1) * 24 * H + 9 * H);
    const mk = async (role?: string) => { const id = randomUUID(), p = h.newPhone(); await h.pool.query(`INSERT INTO identity.users (id, phone) VALUES ($1,$2)`, [id, p]); if (role) await h.pool.query(`INSERT INTO identity.platform_roles (user_id, role) VALUES ($1,$2)`, [id, role]); return { id, p }; };
    const a = await mk('reviewer'), b = await mk('reviewer'), admin = await mk('super_admin'), plain = await mk(), sub = await mk();
    const org = randomUUID(); await h.pool.query(`INSERT INTO identity.organizations (id, name, kind) VALUES ($1,'S6e Org','agency')`, [org]);
    const fx = await h.pool.connect();
    try {
    await fx.query(`SET session_replication_role = replica`);
    // A: 3 approved (one T2) and 1 rejected, plus one release; B: 2 rejected
    const rows: [string, 't1' | 't2', 'approved' | 'rejected', number, number][] = [[a.id, 't1', 'approved', 1, 600], [a.id, 't1', 'approved', 2, 1200], [a.id, 't2', 'approved', 3, 1800], [a.id, 't1', 'rejected', 4, 900], [b.id, 't1', 'rejected', 5, 300], [b.id, 't1', 'rejected', 6, 300]];
    for (const [who, tier, st, day, secs] of rows) {
      const prop = randomUUID(), cid = randomUUID(); let badge: string | null = null;
      await fx.query(`INSERT INTO supply.properties (id, org_id, name, address_text, location) VALUES ($1,$2,$3,'addr',extensions.st_point(36.8,-1.29)::extensions.geography)`, [prop, org, `S6e ${prop}`]);
      if (st === 'approved') { badge = randomUUID(); await fx.query(`INSERT INTO verification.badges (id, subject_type, subject_id, level, issued_at, expires_at) VALUES ($1,'property',$2,$3,$4,$5)`, [badge, prop, tier === 't2' ? 't2_video' : 't1_documented', D(day), new Date(D(day).getTime() + MIN)]); }
      await fx.query(`INSERT INTO verification.cases (id, org_id, property_id, tier, status, submitted_by, submitted_at, due_at, decided_by, decided_at, reason_code, badge_id, t2_checklist) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [cid, org, prop, tier, st, sub.id, new Date(D(day).getTime() - 5 * H), new Date(D(day).getTime() + 24 * H), who, D(day), st === 'rejected' ? 'doc_expired' : null, badge, tier === 't2' && st === 'approved' ? JSON.stringify({ code_heard: true, place_matches_address: true, units_shown: true, footage_continuous: true, location_close: true, matches_documents: true }) : null]);
      await fx.query(`INSERT INTO verification.review_sessions (case_id, reviewer_id, claimed_at, ended_at, end_reason, elapsed_seconds, handling_seconds) VALUES ($1,$2,$3,$4,'decided',$5,$5)`, [cid, who, new Date(D(day).getTime() - secs * 1000), D(day), secs]);
    }
    { const prop = randomUUID(), cid = randomUUID();   // a release by A in the month
      await fx.query(`INSERT INTO supply.properties (id, org_id, name, address_text, location) VALUES ($1,$2,$3,'addr',extensions.st_point(36.8,-1.29)::extensions.geography)`, [prop, org, `S6e ${prop}`]);
      await fx.query(`INSERT INTO verification.cases (id, org_id, property_id, tier, status, submitted_by, submitted_at, due_at) VALUES ($1,$2,$3,'t1','submitted',$4,$5,$6)`, [cid, org, prop, sub.id, D(7), D(12)]);
      await fx.query(`INSERT INTO verification.review_sessions (case_id, reviewer_id, claimed_at, ended_at, end_reason, elapsed_seconds, handling_seconds) VALUES ($1,$2,$3,$4,'released',120,120)`, [cid, a.id, D(7), new Date(D(7).getTime() + 2 * MIN)]); }
    } finally { await fx.query(`SET session_replication_role = DEFAULT`).catch(() => {}); fx.release(); }

    const ta = await h.login(a.p), tb = await h.login(b.p), tadm = await h.login(admin.p), tpl = await h.login(plain.p);
    const G = (path: string, tok: string) => h.call('GET', path, undefined, tok);

    await ctx.test('each reviewer sees exactly their own figures', async () => {
      const ra = (await G(`/review/cases/my-stats?month=${month}`, ta.accessToken)).body, rb = (await G(`/review/cases/my-stats?month=${month}`, tb.accessToken)).body;
      assert.equal(ra.decisions, 4); assert.equal(ra.approved, 3); assert.equal(ra.rejected, 1); assert.equal(ra.t1, 3); assert.equal(ra.t2, 1);
      assert.equal(ra.approvalRatePct, 75); assert.equal(ra.sampleSize, 4); assert.equal(ra.sessions, 5); assert.equal(ra.released, 1); assert.equal(ra.sentBack, 0);
      assert.equal(ra.handlingHours, Math.round((600 + 1200 + 1800 + 900 + 120) / 36) / 100);
      assert.equal(ra.medianHandlingMinutes, 17.5); assert.equal(ra.medianSampleSize, 4);
      assert.equal(rb.decisions, 2); assert.equal(rb.approved, 0); assert.equal(rb.approvalRatePct, 0); assert.equal(rb.released, 0); assert.equal(rb.medianHandlingMinutes, 5);
      assert.ok(!JSON.stringify(ra).includes(b.id) && !JSON.stringify(rb).includes(a.id));
      assert.ok(ra.note.includes('not a score'));
    });

    await ctx.test('an empty month, bad input and who may ask', async () => {
      const e = (await G(`/review/cases/my-stats?month=2024-01`, ta.accessToken)).body;
      if (month !== '2024-01') { assert.equal(e.decisions, 0); assert.equal(e.approvalRatePct, null); assert.equal(e.medianHandlingMinutes, null); }
      assert.equal((await G('/review/cases/my-stats?month=2026-13', ta.accessToken)).status, 400);
      assert.equal((await G('/review/cases/my-stats', ta.accessToken)).status, 200, 'defaults to this month');
      assert.equal((await G('/review/cases/my-stats', tpl.accessToken)).status, 403);
      assert.equal((await G('/review/cases/my-stats', tadm.accessToken)).status, 403, 'an admin who is not a reviewer has no reviewer statistics');
      assert.equal((await h.call('GET', '/review/cases/my-stats')).status, 401);
    });

    await ctx.test('the admin probe is for admins only', async () => {
      assert.equal((await G('/admin/review/access', tadm.accessToken)).status, 200);
      assert.equal((await G('/admin/review/access', ta.accessToken)).status, 403);
      assert.equal((await G('/admin/review/access', tpl.accessToken)).status, 403);
      assert.equal((await h.call('GET', '/admin/review/access')).status, 401);
    });

    await ctx.test('admin reports label reviewers by the last three digits of the phone', async () => {
      const r = (await G(`/admin/reports/reviewers?month=${month}`, tadm.accessToken)).body;
      assert.equal(r.reviewers.find((x: any) => x.reviewerId === a.id).account, '…' + a.p.slice(-3));
      assert.ok(!JSON.stringify(r).includes(a.p), 'never the whole number');
      await h.pool.query(`INSERT INTO verification.integrity_alerts (rule_code, reviewer_id) VALUES ('burst',$1) ON CONFLICT DO NOTHING`, [a.id]);
      const al = (await G('/admin/integrity/alerts?status=all', tadm.accessToken)).body as any[];
      assert.equal(al.find((x) => x.reviewerId === a.id).account, '…' + a.p.slice(-3));
      assert.ok(!JSON.stringify(al).includes(a.p));
    });
  } finally { await h.close(); }
});
