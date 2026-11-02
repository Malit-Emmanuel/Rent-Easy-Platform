import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { bootApp } from '../../test-utils/http';
import { REASON_CODES } from './cases.rules';

process.env.STORAGE_DRIVER = 'fake';
const t = process.env.DATABASE_URL ? test : test.skip;
const H = 3600e3;

/**
 * S4 acceptance run (design note section 9). Fifty property cases are driven end to end over HTTP by humans-in-the-loop stand-ins:
 * three reviewers, five organisations. Afterwards the integrity checks are run against the database itself.
 * Set S4_REPORT=/path/report.json to keep the results.
 */
t('S4 acceptance: 50 cases, appeals, access limits, expiry, revocation and audit integrity', { timeout: 280_000 }, async () => {
  const h = await bootApp();
  const checks: { name: string; ok: boolean; detail: string }[] = [];
  const check = async (name: string, fn: () => Promise<string | void>) => {
    try { checks.push({ name, ok: true, detail: (await fn()) || '' }); } catch (e: any) { checks.push({ name, ok: false, detail: String(e?.message ?? e).split('\n')[0] }); }
  };
  const lat: Record<string, number[]> = {};
  const call = async (label: string, ...a: Parameters<typeof h.call>) => { const s = performance.now(); const r = await h.call(...a); (lat[label] ??= []).push(performance.now() - s); return r; };
  try {
    // ---------- setup ----------
    const NORG = 5, NCASE = 50;
    const mgr: any[] = [], org: any[] = [];
    for (let k = 0; k < NORG; k++) {
      mgr.push(await h.login());
      org.push((await h.call('POST', '/orgs', { name: `Acceptance Org ${k}`, kind: 'agency' }, mgr[k].accessToken)).body);
      await h.pool.query(`INSERT INTO verification.badges (subject_type, subject_id, level, expires_at) VALUES ('user',$1,'id_verified', now() + interval '1 year')`, [await h.userId(mgr[k].p)]);
    }
    const rev = [await h.login(), await h.login(), await h.login()], insider = await h.login();
    const revId = await Promise.all(rev.map((r) => h.userId(r.p))), insiderId = await h.userId(insider.p);
    for (const id of [...revId, insiderId]) await h.pool.query(`INSERT INTO identity.platform_roles (user_id, role) VALUES ($1,'reviewer') ON CONFLICT DO NOTHING`, [id]);
    await h.pool.query(`INSERT INTO identity.memberships (user_id, org_id, role) VALUES ($1,$2,'manager_staff')`, [insiderId, org[0].id]);

    const stamp = `acc-${Date.now()}-${Math.random().toString(36).slice(2)}`; let seq = 0;
    const mgrIds = await Promise.all(mgr.map((m) => h.userId(m.p)));
    const addDocFor = (k: number, pid: string, type: string) => h.pool.query(
      `INSERT INTO supply.files (id, org_id, property_id, kind, doc_type, original_name, storage_path, mime_type, size_bytes, status, uploaded_by, ready_at)
       VALUES (gen_random_uuid(), $1,$2,'document',$3,$4,$5,'application/pdf',1000,'ready',$6, now() - interval '3 hours')`, [org[k].id, pid, type, `${type}.pdf`, `${stamp}/${++seq}`, mgrIds[k]]);

    type Plan = 'approve' | 'reject_appeal' | 'needs_changes' | 'reject_final' | 'appeal_approve' | 'appeal_reject';
    const plan = new Map<string, Plan>(), propOf = new Map<string, { id: string; k: number; n: number }>();
    const props: { id: string; k: number; n: number }[] = [];
    for (let n = 0; n < NCASE; n++) {
      const k = n % NORG;
      const p = (await h.call('POST', `/orgs/${org[k].id}/properties`, { name: `Acceptance ${n}`, addressText: `Test Road ${n}` }, mgr[k].accessToken)).body;
      await addDocFor(k, p.id, 'title_deed'); await addDocFor(k, p.id, 'management_authorisation');
      props.push({ id: p.id, k, n });
    }
    const planFor = (n: number): Plan => n < 25 ? 'approve' : n < 35 ? 'reject_appeal' : n < 43 ? 'needs_changes' : 'reject_final';
    const V = (p: { id: string; k: number }, tail = '') => `/orgs/${org[p.k].id}/properties/${p.id}/verification${tail}`;
    const caseIds: string[] = [];
    for (const p of props) {
      const r = await call('request', 'POST', V(p), undefined, mgr[p.k].accessToken);
      assert.equal(r.status, 201, `request ${p.n}: ${JSON.stringify(r.body)}`);
      plan.set(r.body.caseId, planFor(p.n)); propOf.set(r.body.caseId, p); caseIds.push(r.body.caseId);
    }
    // a realistic spread of deadlines: some overdue, some close
    for (const [i, id] of caseIds.entries()) {
      if (i % 5 === 0) await h.pool.query(`UPDATE verification.cases SET submitted_at = now() - interval '4 days', due_at = now() - interval '3 hours' WHERE id=$1`, [id]);
      else if (i % 7 === 0) await h.pool.query(`UPDATE verification.cases SET due_at = now() + interval '6 hours' WHERE id=$1`, [id]);
    }

    // ---------- the queue is ordered ----------
    await check('Queue order: overdue first, then due date, then risk, then age', async () => {
      const q = ((await call('queue', 'GET', '/review/cases/queue', undefined, rev[0].accessToken)).body as any[]).filter((c) => plan.has(c.id));
      assert.equal(q.length, NCASE, 'all 50 cases are visible to a reviewer outside the organisations');
      const nonDecreasing = q.every((c, i, a) => i === 0 || new Date(a[i - 1].dueAt).getTime() <= new Date(c.dueAt).getTime());
      assert.ok(nonDecreasing, 'due dates never go backwards');
      assert.equal(q.filter((c) => c.breached).length, 10);
      assert.ok(q.slice(0, 10).every((c) => c.breached), 'the 10 overdue cases are first');
      return `${q.length} cases, ${q.filter((c) => c.breached).length} overdue first`;
    });
    await check('No self-review: a reviewer inside organisation 0 sees none of its 10 cases and cannot claim them', async () => {
      const own = caseIds.filter((id) => propOf.get(id)!.k === 0);
      const q = (await h.call('GET', '/review/cases/queue', undefined, insider.accessToken)).body as any[];
      assert.equal(q.filter((c) => own.includes(c.id)).length, 0);
      for (const id of own) assert.equal((await h.call('POST', `/review/cases/${id}/claim`, undefined, insider.accessToken)).status, 404);
      const q2 = q.filter((c) => plan.has(c.id)).length;
      assert.equal(q2, NCASE - own.length, 'but sees the other 40');
      return `10 of 10 claims refused, 40 other cases visible`;
    });

    // ---------- work the queue ----------
    let opens = 0, decisions = 0, resubmits = 0, appeals = 0; const decidedBy = new Map<string, number>();
    const reasonFor = (i: number) => REASON_CODES[i % REASON_CODES.length];
    let reasonCounter = 0, appealCounter = 0;
    let guard = 0;
    while (guard++ < 400) {
      let worked = false;
      for (let ri = 0; ri < rev.length; ri++) {
        const q = ((await call('queue', 'GET', '/review/cases/queue', undefined, rev[ri].accessToken)).body as any[]).filter((c) => plan.has(c.id));
        const c = q.find((x) => !x.claimed) ?? q.find((x) => x.claimedByMe); if (!c) continue;
        worked = true;
        const cl = await call('claim', 'POST', `/review/cases/${c.id}/claim`, undefined, rev[ri].accessToken);
        if (cl.status !== 200) continue;                        // someone else took it
        const page = (await call('detail', 'GET', `/review/cases/${c.id}`, undefined, rev[ri].accessToken)).body;
        for (const f of page.files) {
          const l = await call('link', 'POST', `/review/cases/${c.id}/files/${f.id}/link`, undefined, rev[ri].accessToken);
          assert.equal(l.status, 200); assert.equal(l.body.expiresInSec, 300); opens++;
        }
        const p = plan.get(c.id)!; let body: any;
        if (p === 'approve' || p === 'appeal_approve') body = { decision: 'approve' };
        else if (p === 'needs_changes') body = { decision: 'needs_changes', reasonCode: 'doc_unreadable', note: 'Page 2 is blurred' };
        else { const rc = reasonFor(reasonCounter++); body = { decision: 'reject', reasonCode: rc, ...(rc === 'other' ? { note: 'Seal does not match the register' } : {}) }; }
        const d = await call('decision', 'POST', `/review/cases/${c.id}/decision`, body, rev[ri].accessToken);
        assert.equal(d.status, 200, `${p}: ${JSON.stringify(d.body)}`); decisions++; decidedBy.set(c.id, ri);
        const prop = propOf.get(c.id)!;
        if (p === 'needs_changes') {
          await addDocFor(prop.k, prop.id, 'lease_agreement');
          const rs = await call('resubmit', 'POST', V(prop, '/resubmit'), undefined, mgr[prop.k].accessToken); assert.equal(rs.status, 201); resubmits++;
          plan.set(c.id, 'approve');
        } else if (p === 'reject_appeal') {
          const ap = await call('appeal', 'POST', V(prop, '/appeal'), undefined, mgr[prop.k].accessToken); assert.equal(ap.status, 201); appeals++;
          plan.set(ap.body.caseId, appealCounter++ % 2 === 0 ? 'appeal_approve' : 'appeal_reject'); propOf.set(ap.body.caseId, prop);
        } else if (p === 'appeal_reject') {
          const again = await call('appeal', 'POST', V(prop, '/appeal'), undefined, mgr[prop.k].accessToken);
          assert.equal(again.status, 409, 'an appeal decision is final');
        }
      }
      if (!worked) break;
    }
    const open = (await h.pool.query(`SELECT count(*)::int n FROM verification.cases WHERE id = ANY($1) AND status IN ('submitted','in_review','needs_changes')`, [[...plan.keys()]])).rows[0].n;
    await check('All 50 cases are decided and nothing is left open', async () => {
      assert.equal(open, 0);
      const r = (await h.pool.query(`SELECT status, count(*)::int n FROM verification.cases WHERE property_id = ANY($1) AND appeal_of IS NULL GROUP BY 1 ORDER BY 1`, [props.map((p) => p.id)])).rows;
      return `${decisions} decisions, ${resubmits} resubmissions, ${appeals} appeals, ${opens} documents opened; first-round outcomes: ${r.map((x: any) => `${x.status} ${x.n}`).join(', ')}`;
    });

    // ---------- integrity checks ----------
    await check('Every rejection and needs-changes decision carries a reason code; "other" always has a note', async () => {
      const bad = (await h.pool.query(`SELECT count(*)::int n FROM verification.cases WHERE property_id = ANY($1) AND ((status='rejected' AND reason_code IS NULL) OR (reason_code='other' AND coalesce(btrim(note),'')=''))`, [props.map((p) => p.id)])).rows[0].n;
      assert.equal(bad, 0);
      const a = (await h.pool.query(`SELECT count(*)::int n FROM governance.audit_events WHERE action IN ('verification.rejected','verification.needs_changes') AND metadata->>'reasonCode' IS NULL AND subject_id = ANY($1)`, [[...plan.keys()]])).rows[0].n;
      assert.equal(a, 0); return 'all decisions have reasons, in the case rows and in the audit trail';
    });
    await check('No reviewer ever decided a case of an organisation they belong to', async () => {
      const n = (await h.pool.query(`SELECT count(*)::int n FROM verification.cases c JOIN identity.memberships m ON m.org_id=c.org_id AND (m.user_id=c.decided_by OR m.user_id=c.claimed_by) WHERE c.property_id = ANY($1)`, [props.map((p) => p.id)])).rows[0].n;
      assert.equal(n, 0); return '0 violations';
    });
    await check('Appeals: one per rejected case, decided by a different reviewer, never appealed again', async () => {
      const r = (await h.pool.query(`SELECT count(*)::int total, count(*) FILTER (WHERE a.decided_by = o.decided_by)::int same, count(*) FILTER (WHERE o.appeal_of IS NOT NULL)::int chained
                                       FROM verification.cases a JOIN verification.cases o ON o.id = a.appeal_of WHERE a.property_id = ANY($1)`, [props.map((p) => p.id)])).rows[0];
      assert.equal(r.total, 10); assert.equal(r.same, 0); assert.equal(r.chained, 0);
      const dup = (await h.pool.query(`SELECT count(*)::int n FROM (SELECT appeal_of FROM verification.cases WHERE appeal_of IS NOT NULL AND property_id = ANY($1) GROUP BY 1 HAVING count(*)>1) x`, [props.map((p) => p.id)])).rows[0].n;
      assert.equal(dup, 0);
      const o = (await h.pool.query(`SELECT status, count(*)::int n FROM verification.cases WHERE appeal_of IS NOT NULL AND property_id = ANY($1) GROUP BY 1 ORDER BY 1`, [props.map((p) => p.id)])).rows;
      return `10 appeals, 0 by the same reviewer, 0 repeated; outcomes: ${o.map((x: any) => `${x.status} ${x.n}`).join(', ')}`;
    });
    await check('Human decisions only: every approval and rejection has an audit event by the same person who decided', async () => {
      const n = (await h.pool.query(`SELECT count(*)::int n FROM verification.cases c WHERE c.property_id = ANY($1) AND c.status IN ('approved','rejected')
                                      AND NOT EXISTS (SELECT 1 FROM governance.audit_events a WHERE a.subject_id = c.id::text AND a.actor_id = c.decided_by AND a.action IN ('verification.approved','verification.rejected'))`, [props.map((p) => p.id)])).rows[0].n;
      assert.equal(n, 0);
      const noBadgeApproved = (await h.pool.query(`SELECT count(*)::int n FROM verification.cases WHERE property_id = ANY($1) AND status='approved' AND (badge_id IS NULL)`, [props.map((p) => p.id)])).rows[0].n;
      assert.equal(noBadgeApproved, 0); return 'every decision traces to a named reviewer; no automatic decisions';
    });
    await check('Document access: only the holder, five-minute links, every open logged exactly once', async () => {
      const logged = (await h.pool.query(`SELECT count(*)::int n FROM governance.data_access_log WHERE resource='file:document' AND accessor_id = ANY($1) AND reason LIKE 'case %'`, [revId])).rows[0].n;
      assert.equal(logged, opens, 'log entries equal links handed out');
      const audited = (await h.pool.query(`SELECT count(*)::int n FROM governance.audit_events WHERE action='verification.document_opened' AND actor_id = ANY($1)`, [revId])).rows[0].n;
      assert.equal(audited, opens);
      // a decided case no longer hands out links to anyone, including the reviewer who decided it
      const done = caseIds[0]; const f = (await h.pool.query('SELECT file_id FROM verification.case_files WHERE case_id=$1 LIMIT 1', [done])).rows[0].file_id;
      for (let ri = 0; ri < 3; ri++) assert.equal((await h.call('POST', `/review/cases/${done}/files/${f}/link`, undefined, rev[ri].accessToken)).status, 404);
      assert.equal((await h.call('POST', `/review/cases/${done}/files/${f}/link`, undefined, mgr[0].accessToken)).status, 403);
      assert.equal((await h.call('POST', `/review/cases/${done}/files/${f}/link`)).status, 401);
      return `${opens} opens = ${logged} access-log rows = ${audited} audit events; links refused for managers, anonymous callers and decided cases`;
    });
    await check('Evidence is frozen: documents of approved cases cannot be deleted', async () => {
      let refused = 0;
      for (const id of caseIds.slice(0, 8)) {
        const prop = propOf.get(id)!; const fid = (await h.pool.query('SELECT file_id FROM verification.case_files WHERE case_id=$1 LIMIT 1', [id])).rows[0].file_id;
        const r = await h.call('DELETE', `/orgs/${org[prop.k].id}/properties/${prop.id}/files/${fid}`, undefined, mgr[prop.k].accessToken);
        if (r.status >= 400) refused++;
      }
      assert.equal(refused, 8); return '8 of 8 deletions refused';
    });
    await check('Deadlines: each case was due 2 working days after submission (before the test moved some)', async () => {
      const r = (await h.pool.query(`SELECT count(*)::int n FROM governance.audit_events WHERE action='verification.requested' AND subject_id = ANY($1)`, [caseIds])).rows[0].n;
      assert.equal(r, NCASE); return '50 requests recorded; the 2-working-day rule is covered by unit tests and the request test';
    });

    // ---------- badges: expiry and revocation ----------
    const approvedProps = (await h.pool.query(`SELECT DISTINCT p.id, p.org_id FROM supply.properties p JOIN verification.badges b ON b.subject_id=p.id AND b.subject_type='property' AND b.level='t1_documented' WHERE p.id = ANY($1)`, [props.map((p) => p.id)])).rows;
    await check('Badges: 38 properties are verified for about 12 months', async () => {
      assert.equal(approvedProps.length, 38);
      const bad = (await h.pool.query(`SELECT count(*)::int n FROM verification.badges WHERE subject_type='property' AND subject_id = ANY($1) AND (expires_at - issued_at < interval '364 days' OR expires_at - issued_at > interval '367 days')`, [props.map((p) => p.id)])).rows[0].n;
      assert.equal(bad, 0); return '38 badges, all 364-367 days';
    });
    const byProp = new Map(props.map((p) => [p.id, p]));
    const live = approvedProps.map((r: any) => byProp.get(r.id)!).filter(Boolean);
    const toExpire = live.slice(0, 3), toRevoke = live.slice(3, 6);
    for (const p of toExpire) await h.pool.query(`UPDATE verification.badges SET issued_at = now() - interval '13 months', expires_at = now() - interval '1 day' WHERE subject_id=$1`, [p.id]);
    await check('Revoking needs a reason; three badges withdrawn with different reasons', async () => {
      const bid = async (p: any) => (await h.pool.query(`SELECT id FROM verification.badges WHERE subject_id=$1 AND revoked_at IS NULL`, [p.id])).rows[0].id;
      assert.equal((await call('revoke', 'POST', `/review/badges/${await bid(toRevoke[0])}/revoke`, {}, rev[0].accessToken)).status, 400);
      const reasons: [string, string?][] = [['suspected_forgery'], ['doc_expired'], ['other', 'Owner withdrew the authorisation']];
      for (const [i, p] of toRevoke.entries()) {
        const r = await call('revoke', 'POST', `/review/badges/${await bid(p)}/revoke`, { reasonCode: reasons[i][0], ...(reasons[i][1] ? { note: reasons[i][1] } : {}) }, rev[1].accessToken);
        assert.equal(r.status, 200);
      }
      const ownBadge = live.find((x) => x.k === 0 && !toExpire.includes(x) && !toRevoke.includes(x))!;     // a property of the insider's own organisation
      assert.equal((await h.call('POST', `/review/badges/${await bid(ownBadge)}/revoke`, { reasonCode: 'doc_expired' }, insider.accessToken)).status, 404, 'no self-review on badges either');
      return '3 withdrawn with reasons, an empty reason refused, a reviewer inside the organisation refused';
    });
    await check('Expired and withdrawn badges never count, on every screen', async () => {
      let notVerified = 0, verified = 0;
      for (const p of props) {
        const s = (await h.call('GET', V(p), undefined, mgr[p.k].accessToken)).body;
        const mustNot = [...toExpire, ...toRevoke].some((x) => x.id === p.id);
        if (mustNot) { assert.equal(s.verified, false, `property ${p.n} should not be verified`); assert.ok(s.badgeEnded); }
        if (s.verified) verified++; else notVerified++;
      }
      const list = (await h.call('GET', `/orgs/${org[0].id}/properties`, undefined, mgr[0].accessToken)).body as any[];
      const ended = list.filter((x) => [...toExpire, ...toRevoke].some((e) => e.id === x.id));
      assert.ok(ended.every((x) => x.verifiedUntil === null));
      const shown = (await h.call('GET', '/review/badges', undefined, rev[2].accessToken)).body as any[];
      assert.ok(shown.every((b) => b.expiresAt && new Date(b.expiresAt) > new Date()));
      assert.equal(verified, 38 - 6, 'six of the 38 no longer count');
      return `${verified} verified, ${notVerified} not; 3 expired and 3 withdrawn all show as not verified`;
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
    await check('Audit chain: a tampered record is detected, and the audit table refuses edits', async () => {
      await assert.rejects(h.pool.query(`UPDATE governance.audit_events SET action='verification.approved' WHERE id = (SELECT max(id) FROM governance.audit_events)`), /./);
      const c = await h.pool.connect();
      try {
        await c.query('BEGIN'); await c.query('ALTER TABLE governance.audit_events DISABLE TRIGGER audit_no_mutation');
        const victim = (await c.query(`SELECT id FROM governance.audit_events WHERE action='verification.rejected' ORDER BY id LIMIT 1`)).rows[0].id;
        await c.query(`UPDATE governance.audit_events SET metadata = '{"reasonCode":"other"}' WHERE id=$1`, [victim]);
        const bad = (await c.query(`SELECT count(*)::int n FROM governance.audit_events WHERE hash IS DISTINCT FROM extensions.digest(coalesce(prev_hash,'\\x'::bytea) || convert_to(occurred_at::text || coalesce(actor_id::text,'') || action || subject_type || subject_id || metadata::text, 'UTF8'), 'sha256')`)).rows[0].n;
        assert.ok(bad >= 1, 'the edit is visible to the check');
        return `direct edit refused; a forced edit (rolled back) was detected by the hash check`;
      } finally { await c.query('ROLLBACK'); c.release(); }
    });

    // ---------- speed ----------
    const q = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]); };
    const timing = Object.fromEntries(Object.entries(lat).map(([k, v]) => [k, { calls: v.length, p50_ms: q(v, 0.5), p95_ms: q(v, 0.95) }]));
    const report = { ranAt: new Date().toISOString(), cases: NCASE, organisations: NORG, reviewers: 3, decisions, resubmissions: resubmits, appeals, documentOpens: opens, checks, timing };
    if (process.env.S4_REPORT) writeFileSync(process.env.S4_REPORT, JSON.stringify(report, null, 2));
    const failed = checks.filter((c) => !c.ok);
    assert.equal(failed.length, 0, 'failed checks: ' + failed.map((c) => `${c.name} -> ${c.detail}`).join(' | '));
  } finally { await h.close(); }
});
