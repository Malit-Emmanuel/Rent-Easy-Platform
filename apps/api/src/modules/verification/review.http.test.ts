import test from 'node:test';
import assert from 'node:assert/strict';
import { bootApp } from '../../test-utils/http';

const t = process.env.DATABASE_URL ? test : test.skip;
const H = 3600e3, D = 24 * H;

t('reviewer queue and claim over HTTP: order, no self-review, one holder, release, privacy', async (ctx) => {
  const h = await bootApp();
  try {
    const mgr = await h.login(), insider = await h.login(), r1 = await h.login(), r2 = await h.login();
    const org = (await h.call('POST', '/orgs', { name: 'Queue Agents', kind: 'agency' }, mgr.accessToken)).body;
    const mgrId = await h.userId(mgr.p), r1Id = await h.userId(r1.p), r2Id = await h.userId(r2.p), insiderId = await h.userId(insider.p);
    for (const id of [r1Id, r2Id, insiderId]) await h.pool.query(`INSERT INTO identity.platform_roles (user_id, role) VALUES ($1,'reviewer') ON CONFLICT DO NOTHING`, [id]);
    // the insider is a reviewer who also belongs to the organisation that owns the cases
    await h.pool.query(`INSERT INTO identity.memberships (user_id, org_id, role) VALUES ($1,$2,'manager_staff')`, [insiderId, org.id]);

    const mk = async (name: string, dueInMs: number, flags: string[] = [], status = 'submitted') => {
      const p = (await h.call('POST', `/orgs/${org.id}/properties`, { name, addressText: `${name} Road` }, mgr.accessToken)).body;
      const sub = new Date(Date.now() - 5 * D);
      const id = (await h.pool.query(
        `INSERT INTO verification.cases (org_id, property_id, status, submitted_by, submitted_at, due_at, risk_flags, paused_at, reason_code)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [org.id, p.id, status, mgrId, sub, new Date(Date.now() + dueInMs), flags, status === 'needs_changes' ? new Date() : null, status === 'needs_changes' ? 'doc_unreadable' : null])).rows[0].id;
      return id as string;
    };
    const late = await mk('Late', -3 * H), soon = await mk('Soon', 1 * D), laterPlain = await mk('LaterPlain', 3 * D), laterRisky = await mk('LaterRisky', 3 * D, ['new_organisation', 'lease_only']);
    await h.pool.query(`UPDATE verification.cases SET due_at = (SELECT due_at FROM verification.cases WHERE id=$1) WHERE id=$2`, [laterPlain, laterRisky]);
    const paused = await mk('Paused', 2 * D, [], 'needs_changes');
    const mine = [late, soon, laterRisky, laterPlain];

    await ctx.test('only reviewers can use it', async () => {
      assert.equal((await h.call('GET', '/review/cases/queue', undefined, mgr.accessToken)).status, 403);
      assert.equal((await h.call('GET', '/review/cases/queue')).status, 401);
      assert.equal((await h.call('POST', `/review/cases/${late}/claim`, undefined, mgr.accessToken)).status, 403);
    });

    await ctx.test('queue order: overdue first, then due date, then risk; paused cases are not in it', async () => {
      const q = (await h.call('GET', '/review/cases/queue', undefined, r1.accessToken)).body as any[];
      const ids = q.map((c) => c.id).filter((id) => mine.includes(id));
      assert.deepEqual(ids, [late, soon, laterRisky, laterPlain]);
      assert.ok(!q.some((c) => c.id === paused));
      const first = q.find((c) => c.id === late);
      assert.equal(first.breached, true); assert.ok(first.minutesLeft < 0); assert.equal(first.orgName, 'Queue Agents'); assert.equal(first.propertyName, 'Late');
      assert.deepEqual(q.find((c) => c.id === laterRisky).riskFlags, ['new_organisation', 'lease_only']);
    });

    await ctx.test('no self-review: a reviewer in the organisation sees nothing and cannot claim', async () => {
      const q = (await h.call('GET', '/review/cases/queue', undefined, insider.accessToken)).body as any[];
      assert.equal(q.filter((c) => mine.includes(c.id)).length, 0);
      const r = await h.call('POST', `/review/cases/${late}/claim`, undefined, insider.accessToken);
      assert.equal(r.status, 404);
      assert.equal((await h.pool.query('SELECT status FROM verification.cases WHERE id=$1', [late])).rows[0].status, 'submitted');
    });

    await ctx.test('claim: one holder at a time, repeat claim is harmless, no reviewer identity leaks', async () => {
      const a = await h.call('POST', `/review/cases/${soon}/claim`, undefined, r1.accessToken);
      assert.equal(a.status, 200); assert.equal(a.body.status, 'in_review'); assert.equal(a.body.claimedByMe, true);
      assert.equal((await h.call('POST', `/review/cases/${soon}/claim`, undefined, r1.accessToken)).status, 200);
      const b = await h.call('POST', `/review/cases/${soon}/claim`, undefined, r2.accessToken);
      assert.equal(b.status, 409); assert.equal(b.body.code, 'case_not_claimable');
      const q2 = (await h.call('GET', '/review/cases/queue', undefined, r2.accessToken)).body as any[];
      assert.ok(!q2.some((c) => c.id === soon), 'taken cases leave the other reviewers\' queue');
      const q1 = (await h.call('GET', '/review/cases/queue', undefined, r1.accessToken)).body as any[];
      assert.equal(q1[0].id, soon, 'my claimed cases come first'); assert.equal(q1[0].claimedByMe, true);
      assert.ok(!JSON.stringify(q1).includes(r1Id) && !JSON.stringify(q1).includes(mgrId));
    });

    await ctx.test('racing claims: exactly one winner', async () => {
      const res = await Promise.all([r1, r2].map((r) => h.call('POST', `/review/cases/${late}/claim`, undefined, r.accessToken)));
      assert.deepEqual(res.map((r) => r.status).sort(), [200, 409]);
      assert.equal((await h.pool.query(`SELECT count(*)::int n FROM verification.cases WHERE id=$1 AND claimed_by IS NOT NULL`, [late])).rows[0].n, 1);
    });

    await ctx.test('release: only the holder, and the case returns to the queue', async () => {
      assert.equal((await h.call('POST', `/review/cases/${soon}/release`, undefined, r2.accessToken)).status, 404);
      assert.equal((await h.call('POST', `/review/cases/${soon}/release`, undefined, r1.accessToken)).status, 200);
      const row = (await h.pool.query('SELECT status, claimed_by FROM verification.cases WHERE id=$1', [soon])).rows[0];
      assert.equal(row.status, 'submitted'); assert.equal(row.claimed_by, null);
      assert.equal((await h.call('POST', `/review/cases/${soon}/claim`, undefined, r2.accessToken)).status, 200);
    });

    await ctx.test('unknown and malformed case ids', async () => {
      assert.equal((await h.call('POST', `/review/cases/00000000-0000-4000-8000-000000000000/claim`, undefined, r1.accessToken)).status, 404);
      assert.equal((await h.call('POST', `/review/cases/not-a-uuid/claim`, undefined, r1.accessToken)).status, 400);
      assert.equal((await h.call('POST', `/review/cases/${paused}/claim`, undefined, r1.accessToken)).status, 409);
    });

    await ctx.test('an appeal never goes to the reviewer who decided the original', async () => {
      const p = (await h.call('POST', `/orgs/${org.id}/properties`, { name: 'Appealed', addressText: 'Appealed Road' }, mgr.accessToken)).body;
      const orig = (await h.pool.query(
        `INSERT INTO verification.cases (org_id, property_id, status, submitted_by, submitted_at, due_at, claimed_by, claimed_at, decided_by, decided_at, reason_code)
         VALUES ($1,$2,'rejected',$3, now() - interval '3 days', now() - interval '1 day', $4, now() - interval '2 days', $4, now() - interval '1 day', 'doc_expired') RETURNING id`, [org.id, p.id, mgrId, r1Id])).rows[0].id;
      const ap = (await h.pool.query(
        `INSERT INTO verification.cases (org_id, property_id, status, submitted_by, due_at, appeal_of, risk_flags) VALUES ($1,$2,'submitted',$3, now() + interval '2 days', $4, '{appeal}') RETURNING id`, [org.id, p.id, mgrId, orig])).rows[0].id;
      const q1 = (await h.call('GET', '/review/cases/queue', undefined, r1.accessToken)).body as any[];
      assert.ok(!q1.some((c) => c.id === ap));
      assert.equal((await h.call('POST', `/review/cases/${ap}/claim`, undefined, r1.accessToken)).status, 404);
      const q2 = (await h.call('GET', '/review/cases/queue', undefined, r2.accessToken)).body as any[];
      assert.equal(q2.find((c) => c.id === ap)?.isAppeal, true);
      assert.equal((await h.call('POST', `/review/cases/${ap}/claim`, undefined, r2.accessToken)).status, 200);
    });

    await ctx.test('audit: claims and releases are recorded; queue reads are logged', async () => {
      const a = (await h.pool.query(`SELECT action, count(*)::int n FROM governance.audit_events WHERE subject_id = ANY($1) AND action LIKE 'verification.case_%' GROUP BY 1`, [[...mine]])).rows;
      const m = Object.fromEntries(a.map((r: any) => [r.action, r.n]));
      assert.ok(m['verification.case_claimed'] >= 2); assert.equal(m['verification.case_released'], 1);
      assert.ok((await h.pool.query(`SELECT count(*)::int n FROM governance.data_access_log WHERE accessor_id=$1 AND resource='verification_case_queue'`, [r1Id])).rows[0].n >= 2);
    });
  } finally { await h.close(); }
});
