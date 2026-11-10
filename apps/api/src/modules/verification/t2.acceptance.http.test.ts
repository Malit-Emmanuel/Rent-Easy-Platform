import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { randomUUID } from 'crypto';
import { bootApp } from '../../test-utils/http';
import { T2_REASON_CODES } from './t2.rules';

process.env.STORAGE_DRIVER = 'fake';
const t = process.env.DATABASE_URL ? test : test.skip;

const YES = { code_heard: true, place_matches_address: true, units_shown: true, footage_continuous: true, location_close: true, matches_documents: true };
/** The checklist answer that goes with each rejection reason (a "no" is a record of what the reviewer saw, never a decision). */
const NO_FOR: Record<string, string | null> = {
  t2_code_missing: 'code_heard', t2_location_mismatch: 'location_close', t2_property_mismatch: 'place_matches_address', t2_unit_not_shown: 'units_shown',
  t2_video_unusable: 'footage_continuous', t2_suspected_replay: 'footage_continuous', suspected_forgery: 'matches_documents', other: null,
};
const checklistFor = (reason: string | null) => ({ ...YES, ...(reason && NO_FOR[reason] ? { [NO_FOR[reason]!]: false } : {}) });
const RUN = Array.from({ length: 8 }, () => Math.floor(Math.random() * 256));     // new bytes on every run, so old data cannot trigger the reuse hint
const mp4 = (n: number, variant = 0) => Uint8Array.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32, ...RUN, n, variant, ...new Array(360).fill((n * 7 + variant) % 256)]);

/**
 * S5f acceptance run (design note section 10). Thirty T2 (video and location) cases are driven end to end over HTTP, with stand-ins for
 * managers and for three human reviewers. Afterwards the safety and integrity checks are run against the database itself.
 * Set S5F_REPORT=/path/report.json to keep the results.
 */
t('S5f acceptance: 30 video cases, replay, location, expiry, T1 dependency, pin moves, appeals, deletion and audit integrity', { timeout: 540_000 }, async () => {
  process.env.T2_ENABLED = 'true';
  const h = await bootApp();
  const checks: { name: string; ok: boolean; detail: string }[] = [];
  const check = async (name: string, fn: () => Promise<string | void>) => {
    try { checks.push({ name, ok: true, detail: (await fn()) || '' }); } catch (e: any) { checks.push({ name, ok: false, detail: String(e?.message ?? e).split('\n')[0] }); }
  };
  const lat: Record<string, number[]> = {};
  const call = async (label: string, ...a: Parameters<typeof h.call>) => { const s = performance.now(); const r = await h.call(...a); (lat[label] ??= []).push(performance.now() - s); return r; };
  try {
    const { STORAGE_PORT } = await import('../supply/files/storage.port');
    const fake: any = h.app.get(STORAGE_PORT);
    const { T2RetentionService } = await import('./t2.retention');
    const retention = h.app.get(T2RetentionService);

    // ---------- setup ----------
    const NORG = 5, NCASE = 30;
    const mgr: any[] = [], org: any[] = [], mgrIds: string[] = [];
    for (let k = 0; k < NORG; k++) {
      mgr.push(await h.login());
      org.push((await h.call('POST', '/orgs', { name: `T2 Acceptance Org ${k}`, kind: 'agency' }, mgr[k].accessToken)).body);
      mgrIds.push(await h.userId(mgr[k].p));
      await h.pool.query(`INSERT INTO verification.badges (subject_type, subject_id, level, expires_at) VALUES ('user',$1,'id_verified', now() + interval '1 year')`, [mgrIds[k]]);
    }
    const rev = [await h.login(), await h.login(), await h.login()], insider = await h.login();
    const revId = await Promise.all(rev.map((r) => h.userId(r.p))), insiderId = await h.userId(insider.p);
    for (const id of [...revId, insiderId]) await h.pool.query(`INSERT INTO identity.platform_roles (user_id, role) VALUES ($1,'reviewer') ON CONFLICT DO NOTHING`, [id]);
    await h.pool.query(`INSERT INTO identity.memberships (user_id, org_id, role) VALUES ($1,$2,'manager_staff')`, [insiderId, org[0].id]);

    type Prop = { id: string; k: number; n: number; pin: { lat: number; lon: number }; doc: string };
    const base = { lat: -1.0 - Math.random() * 0.5, lon: 36.2 + Math.random() * 0.5 };
    const V = (p: Prop, tail = '') => `/orgs/${org[p.k].id}/properties/${p.id}/verification/t2${tail}`;
    let docSeq = 0;
    /** A property with a pin, one unit, a title deed and a valid T1 badge: the starting point for a video check. */
    const makeProp = async (n: number, k = n % NORG, withT1 = true): Promise<Prop> => {
      const pin = { lat: base.lat - n * 0.012, lon: base.lon + n * 0.012 };
      const p = (await h.call('POST', `/orgs/${org[k].id}/properties`, { name: `T2 Acceptance ${n}`, addressText: `Test Road ${n}`, latitude: pin.lat, longitude: pin.lon }, mgr[k].accessToken)).body;
      assert.ok(p?.id, 'property created');
      await h.call('POST', `/orgs/${org[k].id}/properties/${p.id}/units`, { label: 'U1', bedrooms: 1 }, mgr[k].accessToken);
      const doc = randomUUID();
      await h.pool.query(`INSERT INTO supply.files (id, org_id, property_id, kind, doc_type, storage_path, original_name, mime_type, size_bytes, uploaded_by, status) VALUES ($1,$2,$3,'document','title_deed',$4,'deed.pdf','application/pdf',100,$5,'ready')`, [doc, org[k].id, p.id, `t2acc/${p.id}/${++docSeq}.pdf`, mgrIds[k]]);
      fake.put(`t2acc/${p.id}/${docSeq}.pdf`, Uint8Array.from([37, 80, 68, 70]));
      if (withT1) await h.pool.query(`INSERT INTO verification.badges (subject_type, subject_id, level, expires_at) VALUES ('property',$1,'t1_documented', now() + interval '1 year')`, [p.id]);
      return { id: p.id, k, n, pin, doc };
    };
    const iso = (s: number) => new Date(Date.now() + s * 1000).toISOString();
    /** Steps 1 to 3 of a recording: code, take, upload. Returns what is needed to submit. */
    const prepare = async (p: Prop, bytes: Uint8Array) => {
      const ch = await call('challenge', 'POST', V(p, '/challenge'), { consent: true }, mgr[p.k].accessToken); assert.equal(ch.status, 201, JSON.stringify(ch.body));
      const tk = await call('take', 'POST', V(p, `/challenge/${ch.body.id}/take`), { mimeType: 'video/mp4', sizeBytes: bytes.length }, mgr[p.k].accessToken); assert.equal(tk.status, 201, JSON.stringify(tk.body));
      const path = (await h.pool.query('SELECT storage_path FROM supply.files WHERE id=$1', [tk.body.fileId])).rows[0].storage_path;
      fake.put(path, bytes);
      const done = await call('complete', 'POST', `/orgs/${org[p.k].id}/properties/${p.id}/files/${tk.body.fileId}/complete`, undefined, mgr[p.k].accessToken); assert.equal(done.status, 200, JSON.stringify(done.body));
      return { challengeId: ch.body.id as string, fileId: tk.body.fileId as string, path: path as string };
    };
    const readings = (p: Prop, off = { lat: 0.0002, lon: 0 }) => ({
      start: { lat: p.pin.lat + off.lat, lon: p.pin.lon + off.lon, accuracyM: 12, at: iso(0) },
      end: { lat: p.pin.lat + off.lat + 0.0001, lon: p.pin.lon + off.lon, accuracyM: 12, at: iso(45) },
    });
    const record = async (p: Prop, bytes: Uint8Array, off?: { lat: number; lon: number }) => {
      const x = await prepare(p, bytes);
      const sub = await call('submit', 'POST', V(p, '/submit'), { challengeId: x.challengeId, fileId: x.fileId, ...readings(p, off) }, mgr[p.k].accessToken);
      assert.equal(sub.status, 201, `submit ${p.n}: ${JSON.stringify(sub.body)}`);
      return { caseId: sub.body.caseId as string, fileId: x.fileId, path: x.path };
    };

    // ---------- the 30 cases ----------
    // 0-15 approve | 16-21 reject then appeal (3 appeals approved, 3 rejected) | 22-25 sent back, re-recorded, approved
    // 26-27 reuse the video of case 0 and 1 (replay) | 28-29 recorded about 22 km from the pin (location)
    type Plan = 'approve' | 'reject_appeal' | 'needs_changes' | 'replay' | 'far' | 'appeal_approve' | 'appeal_reject';
    const planFor = (n: number): Plan => n < 16 ? 'approve' : n < 22 ? 'reject_appeal' : n < 26 ? 'needs_changes' : n < 28 ? 'replay' : 'far';
    const plan = new Map<string, Plan>(), propOf = new Map<string, Prop>(), videoOf = new Map<string, { fileId: string; path: string }>();
    const props: Prop[] = [], caseIds: string[] = [], flagsSeen = new Map<string, string[]>(), firstCaseOf = new Map<number, string>();
    for (let n = 0; n < NCASE; n++) {
      const p = await makeProp(n); props.push(p);
      const kind = planFor(n);
      const bytes = kind === 'replay' ? mp4(n - 26) : mp4(n);                      // replay cases re-send the exact video of case 0 and 1
      const r = await record(p, bytes, kind === 'far' ? { lat: 0.2, lon: 0 } : undefined);
      plan.set(r.caseId, kind); propOf.set(r.caseId, p); caseIds.push(r.caseId); videoOf.set(r.caseId, r); firstCaseOf.set(n, r.caseId);
    }
    // a realistic spread of deadlines: some overdue, some close
    for (const [i, id] of caseIds.entries()) {
      if (i % 5 === 0) await h.pool.query(`UPDATE verification.cases SET submitted_at = now() - interval '6 days', due_at = now() - interval '3 hours' WHERE id=$1`, [id]);
      else if (i % 7 === 0) await h.pool.query(`UPDATE verification.cases SET due_at = now() + interval '6 hours' WHERE id=$1`, [id]);
    }

    // ---------- before any decision ----------
    await check('Queue: all 30 cases show as video cases, overdue first, then by due date', async () => {
      const q = ((await call('queue', 'GET', '/review/cases/queue', undefined, rev[0].accessToken)).body as any[]).filter((c) => plan.has(c.id));
      assert.equal(q.length, NCASE);
      assert.ok(q.every((c) => c.tier === 't2' && c.riskFlags.includes('t2')), 'every row is marked as a video case');
      assert.ok(q.every((c, i, a) => i === 0 || new Date(a[i - 1].dueAt).getTime() <= new Date(c.dueAt).getTime()), 'due dates never go backwards');
      const overdue = q.filter((c) => c.breached).length; assert.equal(overdue, 6);
      assert.ok(q.slice(0, overdue).every((c) => c.breached), 'overdue cases come first');
      for (const c of q) flagsSeen.set(c.id, c.riskFlags);
      return `${q.length} cases, ${overdue} overdue first`;
    });
    await check('No self-review: a reviewer inside organisation 0 sees none of its 6 cases, cannot claim or open their video', async () => {
      const own = caseIds.filter((id) => propOf.get(id)!.k === 0);
      const q = (await h.call('GET', '/review/cases/queue', undefined, insider.accessToken)).body as any[];
      assert.equal(q.filter((c) => own.includes(c.id)).length, 0);
      for (const id of own) {
        assert.equal((await h.call('POST', `/review/cases/${id}/claim`, undefined, insider.accessToken)).status, 404);
        assert.equal((await h.call('POST', `/review/cases/${id}/video/link`, undefined, insider.accessToken)).status, 404);
        assert.equal((await h.call('GET', `/review/cases/${id}`, undefined, insider.accessToken)).status, 404);
      }
      assert.equal(q.filter((c) => plan.has(c.id)).length, NCASE - own.length);
      return `${own.length} of ${own.length} claims, video links and case pages refused; the other ${NCASE - own.length} cases are visible`;
    });
    await check('Replay: the two re-sent videos are flagged as reused; no fresh video is', async () => {
      const reused = caseIds.filter((id) => flagsSeen.get(id)!.includes('video_reused'));
      assert.deepEqual(reused.sort(), [firstCaseOf.get(26)!, firstCaseOf.get(27)!].sort(), 'only the two replay cases carry the flag');
      return '2 of 2 re-sent videos flagged, 0 false alarms among the other 28';
    });
    await check('Location: the two far recordings are flagged strongly; the 28 near ones are not', async () => {
      const far = caseIds.filter((id) => flagsSeen.get(id)!.includes('location_very_far'));
      assert.deepEqual(far.sort(), [firstCaseOf.get(28)!, firstCaseOf.get(29)!].sort());
      assert.equal(caseIds.filter((id) => flagsSeen.get(id)!.some((f) => f === 'location_far' || f === 'readings_disagree' || f === 'same_place_other_property')).length, 0);
      return '2 of 2 far recordings flagged, no other location flags';
    });
    await check('Hints advise only: flagged cases stay open until a person decides', async () => {
      const flagged = caseIds.filter((id) => flagsSeen.get(id)!.some((f) => ['video_reused', 'location_very_far'].includes(f)));
      assert.equal(flagged.length, 4);
      const r = (await h.pool.query(`SELECT count(*)::int n FROM verification.cases WHERE id = ANY($1) AND status = 'submitted' AND decided_by IS NULL`, [flagged])).rows[0].n;
      assert.equal(r, 4, 'all four are still waiting for a reviewer');
      return '4 flagged cases untouched by the system; waiting for people';
    });

    // ---------- work the queue ----------
    let videoOpens = 0, docOpens = 0, decisions = 0, rerecords = 0, appeals = 0; const decidedBy = new Map<string, number>(), reasonOf = new Map<string, string>();
    const appealReasons = ['t2_code_missing', 't2_property_mismatch', 't2_unit_not_shown', 't2_video_unusable', 'suspected_forgery', 'other'];
    let appealReasonCounter = 0, appealCounter = 0, guard = 0;
    const earlyApproveProbe = { done: false };
    while (guard++ < 500) {
      let worked = false;
      for (let ri = 0; ri < rev.length; ri++) {
        const q = ((await call('queue', 'GET', '/review/cases/queue', undefined, rev[ri].accessToken)).body as any[]).filter((c) => plan.has(c.id));
        const c = q.find((x) => !x.claimed) ?? q.find((x) => x.claimedByMe); if (!c) continue;
        worked = true;
        const cl = await call('claim', 'POST', `/review/cases/${c.id}/claim`, undefined, rev[ri].accessToken);
        if (cl.status !== 200) continue;                                                // someone else took it
        const page = (await call('detail', 'GET', `/review/cases/${c.id}`, undefined, rev[ri].accessToken)).body;
        const p = plan.get(c.id)!;
        if (!earlyApproveProbe.done) {                                                    // approval before looking is refused (checked once, on the first case)
          const early = await h.call('POST', `/review/cases/${c.id}/decision`, { decision: 'approve', checklist: YES }, rev[ri].accessToken);
          assert.equal(early.status, 422); earlyApproveProbe.done = true;
        }
        const v = await call('videolink', 'POST', `/review/cases/${c.id}/video/link`, undefined, rev[ri].accessToken);
        assert.equal(v.status, 200); assert.equal(v.body.expiresInSec, 300); videoOpens++;
        for (const f of page.files) { const l = await call('doclink', 'POST', `/review/cases/${c.id}/files/${f.id}/link`, undefined, rev[ri].accessToken); assert.equal(l.status, 200); assert.equal(l.body.expiresInSec, 300); docOpens++; }
        let body: any; const approve = p === 'approve' || p === 'appeal_approve';
        if (approve) body = { decision: 'approve', checklist: YES };
        else if (p === 'needs_changes') body = { decision: 'needs_changes', checklist: checklistFor('t2_location_mismatch'), reasonCode: 't2_location_mismatch', note: 'Please record again from the gate' };
        else {
          const rc = p === 'replay' ? 't2_suspected_replay' : p === 'far' ? 't2_location_mismatch' : appealReasons[appealReasonCounter++ % appealReasons.length];
          body = { decision: 'reject', checklist: checklistFor(rc), reasonCode: rc, ...(rc === 'other' ? { note: 'The compound shown is a different one' } : {}) };
          reasonOf.set(c.id, rc);
        }
        const d = await call('decision', 'POST', `/review/cases/${c.id}/decision`, body, rev[ri].accessToken);
        assert.equal(d.status, 200, `${p}: ${JSON.stringify(d.body)}`); decisions++; decidedBy.set(c.id, ri);
        const prop = propOf.get(c.id)!;
        if (p === 'needs_changes') {
          await record(prop, mp4(prop.n, 1)); rerecords++;                                // the manager records again; the same case is resubmitted
          plan.set(c.id, 'approve');
        } else if (p === 'reject_appeal') {
          const ap = await call('appeal', 'POST', V(prop, '/appeal'), undefined, mgr[prop.k].accessToken); assert.equal(ap.status, 201, JSON.stringify(ap.body)); appeals++;
          plan.set(ap.body.caseId, appealCounter++ % 2 === 0 ? 'appeal_approve' : 'appeal_reject'); propOf.set(ap.body.caseId, prop);
        } else if (p === 'appeal_reject') {
          assert.equal((await call('appeal', 'POST', V(prop, '/appeal'), undefined, mgr[prop.k].accessToken)).status, 409, 'an appeal decision is final');
        }
      }
      if (!worked) break;
    }
    const allCases = [...plan.keys()];
    await check('All 30 cases are decided and nothing is left open', async () => {
      const open = (await h.pool.query(`SELECT count(*)::int n FROM verification.cases WHERE id = ANY($1) AND status IN ('submitted','in_review','needs_changes')`, [allCases])).rows[0].n;
      assert.equal(open, 0);
      const r = (await h.pool.query(`SELECT status, count(*)::int n FROM verification.cases WHERE property_id = ANY($1) AND appeal_of IS NULL GROUP BY 1 ORDER BY 1`, [props.map((p) => p.id)])).rows;
      return `${decisions} decisions, ${rerecords} re-recordings, ${appeals} appeals, ${videoOpens} videos and ${docOpens} documents opened; first-round outcomes: ${r.map((x: any) => `${x.status} ${x.n}`).join(', ')}`;
    });

    // ---------- decisions are human, reasoned and recorded ----------
    const propIds = props.map((p) => p.id);
    await check('Every rejection and send-back carries a video reason; "other" always has a note', async () => {
      const bad = (await h.pool.query(`SELECT count(*)::int n FROM verification.cases WHERE property_id = ANY($1) AND tier='t2' AND ((status='rejected' AND reason_code IS NULL) OR (reason_code='other' AND coalesce(btrim(note),'')='') OR (reason_code IS NOT NULL AND NOT (reason_code = ANY($2))))`, [propIds, [...T2_REASON_CODES]])).rows[0].n;
      assert.equal(bad, 0);
      const aud = (await h.pool.query(`SELECT count(*)::int n FROM governance.audit_events WHERE action IN ('verification.rejected','verification.needs_changes') AND metadata->>'reasonCode' IS NULL AND subject_id = ANY($1)`, [allCases])).rows[0].n;
      assert.equal(aud, 0); return 'all reasons present and from the video list, in the case rows and in the audit trail';
    });
    await check('The six-question checklist is saved on every decision, and every approval has six yeses', async () => {
      const missing = (await h.pool.query(`SELECT count(*)::int n FROM verification.cases WHERE id = ANY($1) AND status IN ('approved','rejected') AND (t2_checklist IS NULL OR (SELECT count(*) FROM jsonb_object_keys(t2_checklist)) <> 6)`, [allCases])).rows[0].n;
      assert.equal(missing, 0);
      const weak = (await h.pool.query(`SELECT count(*)::int n FROM verification.cases WHERE id = ANY($1) AND status='approved' AND (t2_checklist::text LIKE '%false%')`, [allCases])).rows[0].n;
      assert.equal(weak, 0);
      const inAudit = (await h.pool.query(`SELECT count(*)::int n FROM governance.audit_events WHERE action IN ('verification.approved','verification.rejected','verification.needs_changes') AND subject_id = ANY($1) AND metadata ? 'checklist'`, [allCases])).rows[0].n;
      const decided = (await h.pool.query(`SELECT count(*)::int n FROM governance.audit_events WHERE action IN ('verification.approved','verification.rejected','verification.needs_changes') AND subject_id = ANY($1)`, [allCases])).rows[0].n;
      assert.equal(inAudit, decided); return `${decided} decisions, each with a six-answer checklist in the audit trail`;
    });
    await check('Human decisions only: every approval and rejection traces to the named reviewer who decided it', async () => {
      const n = (await h.pool.query(`SELECT count(*)::int n FROM verification.cases c WHERE c.id = ANY($1) AND c.status IN ('approved','rejected')
                                      AND NOT EXISTS (SELECT 1 FROM governance.audit_events a WHERE a.subject_id = c.id::text AND a.actor_id = c.decided_by AND a.action IN ('verification.approved','verification.rejected'))`, [allCases])).rows[0].n;
      assert.equal(n, 0);
      const none = (await h.pool.query(`SELECT count(*)::int n FROM verification.cases WHERE id = ANY($1) AND status IN ('approved','rejected') AND (decided_by IS NULL OR decided_by <> ALL($2))`, [allCases, revId])).rows[0].n;
      assert.equal(none, 0);
      const noBadge = (await h.pool.query(`SELECT count(*)::int n FROM verification.cases WHERE id = ANY($1) AND status='approved' AND badge_id IS NULL`, [allCases])).rows[0].n;
      assert.equal(noBadge, 0); return 'no automatic decisions; no approval without a badge issued by a reviewer';
    });
    await check('No reviewer decided or claimed a case of an organisation they belong to', async () => {
      const n = (await h.pool.query(`SELECT count(*)::int n FROM verification.cases c JOIN identity.memberships m ON m.org_id=c.org_id AND (m.user_id=c.decided_by OR m.user_id=c.claimed_by) WHERE c.property_id = ANY($1)`, [propIds])).rows[0].n;
      assert.equal(n, 0); return '0 violations';
    });
    await check('Appeals: one per rejected case, decided by a different reviewer, never appealed again', async () => {
      const r = (await h.pool.query(`SELECT count(*)::int total, count(*) FILTER (WHERE a.decided_by = o.decided_by)::int same, count(*) FILTER (WHERE o.appeal_of IS NOT NULL)::int chained
                                       FROM verification.cases a JOIN verification.cases o ON o.id = a.appeal_of WHERE a.property_id = ANY($1)`, [propIds])).rows[0];
      assert.equal(r.total, 6); assert.equal(r.same, 0); assert.equal(r.chained, 0);
      const dup = (await h.pool.query(`SELECT count(*)::int n FROM (SELECT appeal_of FROM verification.cases WHERE appeal_of IS NOT NULL AND property_id = ANY($1) GROUP BY 1 HAVING count(*)>1) x`, [propIds])).rows[0].n;
      assert.equal(dup, 0);
      const o = (await h.pool.query(`SELECT status, count(*)::int n FROM verification.cases WHERE appeal_of IS NOT NULL AND property_id = ANY($1) GROUP BY 1 ORDER BY 1`, [propIds])).rows;
      return `6 appeals, 0 by the same reviewer, 0 repeated; outcomes: ${o.map((x: any) => `${x.status} ${x.n}`).join(', ')}`;
    });

    // ---------- video and location privacy ----------
    await check('Video access: holder only, five-minute links, every open logged exactly once; decided cases hand out nothing', async () => {
      const logged = (await h.pool.query(`SELECT count(*)::int n FROM governance.data_access_log WHERE resource='file:video' AND accessor_id = ANY($1) AND reason LIKE 'case %'`, [revId])).rows[0].n;
      assert.equal(logged, videoOpens, 'log rows equal links handed out');
      const audited = (await h.pool.query(`SELECT count(*)::int n FROM governance.audit_events WHERE action='verification.video_opened' AND actor_id = ANY($1)`, [revId])).rows[0].n;
      assert.equal(audited, videoOpens);
      const done = caseIds[0];
      for (let ri = 0; ri < 3; ri++) assert.equal((await h.call('POST', `/review/cases/${done}/video/link`, undefined, rev[ri].accessToken)).status, 404);
      assert.equal((await h.call('POST', `/review/cases/${done}/video/link`, undefined, mgr[0].accessToken)).status, 403);
      assert.equal((await h.call('POST', `/review/cases/${done}/video/link`)).status, 401);
      return `${videoOpens} video opens = ${logged} access-log rows = ${audited} audit events; links refused to managers, anonymous callers and, once decided, to every reviewer`;
    });
    await check('Managers never see the computed hints, distances, flags, fingerprints or who decided', async () => {
      let looked = 0;
      for (const p of props) {
        const s = JSON.stringify((await h.call('GET', V(p), undefined, mgr[p.k].accessToken)).body);
        assert.ok(!/hints|distanceM|video_reused|location_very_far|riskFlags|sha256|storage_path/.test(s), `property ${p.n}`);
        for (const id of revId) assert.ok(!s.includes(id));
        looked++;
      }
      return `${looked} manager status pages checked`;
    });
    await check('Location: exactly two readings per recording, no tracking, and no coordinates or codes in the audit trail', async () => {
      const ev = (await h.pool.query(`SELECT count(*)::int n, count(*) FILTER (WHERE start_lat IS NOT NULL AND start_at IS NOT NULL AND end_lat IS NOT NULL AND end_at IS NOT NULL)::int two, count(*) FILTER (WHERE end_at - start_at > interval '3 minutes')::int long FROM verification.t2_evidence e JOIN verification.cases c ON c.id = e.case_id WHERE c.property_id = ANY($1)`, [propIds])).rows[0];
      assert.equal(ev.two, ev.n); assert.equal(ev.long, 0);
      const cols = (await h.pool.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='verification' AND table_name='t2_evidence' AND column_name ~ '(lat|lon|_at)$'`)).rows.map((r: any) => r.column_name).sort();
      assert.deepEqual(cols, ['end_at', 'end_lat', 'end_lon', 'start_at', 'start_lat', 'start_lon', 'submitted_at'].filter((c) => cols.includes(c)), 'only a start and an end reading are stored');
      const leak = (await h.pool.query(`SELECT count(*)::int n FROM governance.audit_events WHERE action LIKE 'verification.%' AND (subject_id = ANY($1) OR metadata->>'propertyId' = ANY($2)) AND metadata::text ~* '"(lat|lon|latitude|longitude|code|accuracyM)"'`, [allCases, propIds])).rows[0].n;
      assert.equal(leak, 0); return `${ev.n} recordings, each with exactly 2 readings under 3 minutes apart; 0 audit events with coordinates or codes`;
    });
    await check('Evidence is frozen: the video of a decided case cannot be deleted by the manager', async () => {
      let refused = 0, tried = 0;
      for (const id of caseIds.slice(0, 8)) {
        const prop = propOf.get(id)!; tried++;
        const r = await h.call('DELETE', `/orgs/${org[prop.k].id}/properties/${prop.id}/files/${videoOf.get(id)!.fileId}`, undefined, mgr[prop.k].accessToken);
        if (r.status >= 400) refused++;
      }
      assert.equal(refused, tried); return `${refused} of ${tried} deletions refused`;
    });

    // ---------- the recording rules, tried on extra properties (not part of the 30) ----------
    await check('Recording rules: one-time code, 30-minute window, no consent, no T1, take limit and bad readings are all refused', async () => {
      const out: string[] = [];
      const old = firstCaseOf.get(26)!, op = propOf.get(old)!;                                  // decided and not open: only the spent code or used video can be the reason
      const ev = (await h.pool.query(`SELECT challenge_id, video_file_id FROM verification.t2_evidence WHERE case_id=$1`, [old])).rows[0];
      const again = await h.call('POST', V(op, '/submit'), { challengeId: ev.challenge_id, fileId: ev.video_file_id, ...readings(op) }, mgr[op.k].accessToken);
      assert.ok(again.status >= 400 && again.status < 500, `a spent code cannot be used twice: ${again.status}`); out.push(`reused code ${again.status}`);

      const pe = await makeProp(101, 2);
      const exp = await prepare(pe, mp4(101));
      const cx = await h.pool.connect();
      try {
        await cx.query('BEGIN'); await cx.query('ALTER TABLE verification.t2_challenges DISABLE TRIGGER USER');
        await cx.query(`UPDATE verification.t2_challenges SET issued_at = now() - interval '3 hours', expires_at = now() - interval '2 hours 30 minutes', consent_at = now() - interval '3 hours' WHERE id=$1`, [exp.challengeId]);
        await cx.query('ALTER TABLE verification.t2_challenges ENABLE TRIGGER USER'); await cx.query('COMMIT');
      } catch (e) { await cx.query('ROLLBACK').catch(() => {}); throw e; } finally { cx.release(); }
      const late = await h.call('POST', V(pe, '/submit'), { challengeId: exp.challengeId, fileId: exp.fileId, ...readings(pe) }, mgr[2].accessToken);
      assert.ok(late.status >= 400 && late.status < 500, `a submission long after the window is refused: ${late.status}`); out.push(`expired code ${late.status}`);

      const pc = await makeProp(102, 3);
      const noConsent = await h.call('POST', V(pc, '/challenge'), {}, mgr[3].accessToken); assert.equal(noConsent.status, 400); out.push('no consent 400');
      const ch = await h.call('POST', V(pc, '/challenge'), { consent: true }, mgr[3].accessToken); assert.equal(ch.status, 201);
      for (let i = 1; i <= 3; i++) assert.equal((await h.call('POST', V(pc, `/challenge/${ch.body.id}/take`), { mimeType: 'video/mp4', sizeBytes: 400 }, mgr[3].accessToken)).status, 201);
      const fourth = await h.call('POST', V(pc, `/challenge/${ch.body.id}/take`), { mimeType: 'video/mp4', sizeBytes: 400 }, mgr[3].accessToken);
      assert.ok(fourth.status >= 400 && fourth.status < 500, `a fourth take is refused: ${fourth.status}`); out.push(`4th take ${fourth.status}`);

      const pb = await makeProp(103, 4);
      const x = await prepare(pb, mp4(103));
      const bad = [
        { ...readings(pb), start: { ...readings(pb).start, lat: 51.5, lon: -0.12 } },                                   // outside Kenya
        { ...readings(pb), end: { ...readings(pb).end, at: iso(600) } },                                                // ten minutes apart
        { start: readings(pb).start },                                                                                  // one reading only
      ];
      for (const b of bad) { const r = await h.call('POST', V(pb, '/submit'), { challengeId: x.challengeId, fileId: x.fileId, ...b }, mgr[4].accessToken); assert.equal(r.status, 400, JSON.stringify(r.body)); }
      out.push('3 bad reading sets 400');

      const pn = await makeProp(104, 0, false);                                                                          // no T1
      const noT1 = await h.call('POST', V(pn, '/challenge'), { consent: true }, mgr[0].accessToken);
      assert.ok(noT1.status >= 400 && noT1.status < 500); assert.ok((await h.call('GET', V(pn), undefined, mgr[0].accessToken)).body.blockers.includes('no_valid_t1')); out.push(`no T1 ${noT1.status}`);
      return out.join('; ');
    });
    await check('Kill switch: with video checks switched off no new recording can start', async () => {
      const pk = await makeProp(105, 1);
      process.env.T2_ENABLED = 'false';
      try {
        const off = await h.call('POST', V(pk, '/challenge'), { consent: true }, mgr[1].accessToken);
        assert.ok(off.status >= 400 && off.status < 500, `refused while off: ${off.status}`);
        const st = (await h.call('GET', V(pk), undefined, mgr[1].accessToken)).body; assert.equal(st.enabled, false);
        return `new recording refused (${off.status}) while switched off`;
      } finally { process.env.T2_ENABLED = 'true'; }
    });

    // ---------- badges ----------
    const t2Badges = (await h.pool.query(`SELECT b.id, b.subject_id AS property_id, b.issued_at, b.expires_at, b.anchor_lat FROM verification.badges b WHERE b.level='t2_video' AND b.subject_id = ANY($1)`, [propIds])).rows;
    await check('Video badges: 23 properties are video verified for about 6 months, each with a valid T1 behind it', async () => {
      assert.equal(t2Badges.length, 23, '16 first time + 4 after re-recording + 3 on appeal');
      const bad = t2Badges.filter((b: any) => { const d = (new Date(b.expires_at).getTime() - new Date(b.issued_at).getTime()) / 86400e3; return d < 178 || d > 186; });
      assert.equal(bad.length, 0);
      const noT1 = (await h.pool.query(`SELECT count(*)::int n FROM verification.badges b WHERE b.id = ANY($1) AND NOT EXISTS (SELECT 1 FROM verification.badges t1 WHERE t1.subject_id = b.subject_id AND t1.level='t1_documented' AND t1.revoked_at IS NULL)`, [t2Badges.map((b: any) => b.id)])).rows[0].n;
      assert.equal(noT1, 0);
      assert.ok(t2Badges.every((b: any) => b.anchor_lat !== null), 'each badge remembers the position it was approved at');
      return '23 badges, all 178 to 186 days, all with a T1 and an approved position';
    });
    const byProp = new Map(props.map((p) => [p.id, p]));
    const live = t2Badges.map((b: any) => ({ ...byProp.get(b.property_id)!, badgeId: b.id as string }));
    const [toExpire, toRevoke, toLapse, toMove] = [live.slice(0, 3), live.slice(3, 6), live.slice(6, 8), live.slice(8, 10)], toNudge = live[10];
    const ownOrg = live.slice(11).find((x) => x.k === 0)!;
    const lapsedIds = new Set(toLapse.map((x) => x.badgeId));
    for (const x of toExpire) await h.pool.query(`UPDATE verification.badges SET issued_at = now() - interval '185 days', expires_at = now() - interval '1 day' WHERE id=$1`, [x.badgeId]);
    for (const x of toLapse) await h.pool.query(`UPDATE verification.badges SET revoked_at = now(), revoke_reason_code = 'doc_expired' WHERE subject_id=$1 AND level='t1_documented'`, [x.id]);
    await check('Withdrawing a video badge needs a video reason; three are withdrawn; a reviewer inside the organisation is refused', async () => {
      assert.equal((await call('revoke', 'POST', `/review/badges/${toRevoke[0].badgeId}/revoke`, {}, rev[0].accessToken)).status, 400);
      assert.equal((await call('revoke', 'POST', `/review/badges/${toRevoke[0].badgeId}/revoke`, { reasonCode: 'doc_expired' }, rev[0].accessToken)).status, 400, 'document reasons do not apply to a video badge');
      const reasons: [string, string?][] = [['t2_suspected_replay'], ['t2_property_mismatch'], ['other', 'The owner withdrew consent for the video']];
      for (const [i, x] of toRevoke.entries()) assert.equal((await call('revoke', 'POST', `/review/badges/${x.badgeId}/revoke`, { reasonCode: reasons[i][0], ...(reasons[i][1] ? { note: reasons[i][1] } : {}) }, rev[1].accessToken)).status, 200);
      assert.equal((await h.call('POST', `/review/badges/${ownOrg.badgeId}/revoke`, { reasonCode: 't2_property_mismatch' }, insider.accessToken)).status, 404, 'no self-review on badges either');
      const flagged = (await h.pool.query(`SELECT count(*)::int n FROM governance.audit_events WHERE action='verification.badge_revoked' AND subject_id = ANY($1) AND metadata->>'tier'='t2' AND (metadata->>'flagged')::boolean`, [toRevoke.map((x) => x.badgeId)])).rows[0].n;
      assert.equal(flagged, 1, 'the suspected replay is flagged');
      return '3 withdrawn with different reasons, an empty reason and a document reason refused, an insider refused; suspected replay flagged';
    });
    await check('Moving the pin more than 100 m ends the video badge but not T1; a 50 m correction does not', async () => {
      for (const x of toMove) assert.equal((await h.call('PATCH', `/orgs/${org[x.k].id}/properties/${x.id}`, { latitude: x.pin.lat + 0.00135, longitude: x.pin.lon }, mgr[x.k].accessToken)).status, 200);
      assert.equal((await h.call('PATCH', `/orgs/${org[toNudge.k].id}/properties/${toNudge.id}`, { latitude: toNudge.pin.lat + 0.00045, longitude: toNudge.pin.lon }, mgr[toNudge.k].accessToken)).status, 200);
      for (const x of toMove) {
        const s = (await h.call('GET', V(x), undefined, mgr[x.k].accessToken)).body;
        assert.equal(s.badge, null); assert.equal(s.badgeEnded.reasonCode, 't2_position_moved');
        assert.equal((await h.pool.query(`SELECT count(*)::int n FROM verification.badges WHERE subject_id=$1 AND level='t1_documented' AND revoked_at IS NULL`, [x.id])).rows[0].n, 1, 'T1 stays');
      }
      assert.ok((await h.call('GET', V(toNudge), undefined, mgr[toNudge.k].accessToken)).body.badge, 'a 50 m correction keeps the badge');
      const aud = (await h.pool.query(`SELECT count(*)::int n FROM governance.audit_events WHERE action='verification.badge_revoked' AND metadata->>'reasonCode'='t2_position_moved' AND subject_id = ANY($1) AND actor_id IS NULL`, [toMove.map((x) => x.badgeId)])).rows[0].n;
      assert.equal(aud, 2); return '2 badges ended by a 135 m move, each audited; 1 move of 50 m kept its badge; T1 untouched';
    });
    await check('Expired, withdrawn, moved and T1-lapsed video badges never count; only the 13 valid ones do', async () => {
      for (const x of toExpire) { const s = (await h.call('GET', V(x), undefined, mgr[x.k].accessToken)).body; assert.equal(s.badge, null); assert.equal(s.badgeEnded.kind, 'expired'); }
      for (const x of toRevoke) { const s = (await h.call('GET', V(x), undefined, mgr[x.k].accessToken)).body; assert.equal(s.badge, null); assert.equal(s.badgeEnded.kind, 'revoked'); }
      for (const x of toLapse) { const s = (await h.call('GET', V(x), undefined, mgr[x.k].accessToken)).body; assert.equal(s.badge, null); assert.ok(s.suspended); assert.ok(s.blockers.includes('no_valid_t1')); }
      const n = (await h.pool.query(`SELECT count(*)::int n FROM verification.property_badge_status WHERE property_id = ANY($1) AND t2_effective_until IS NOT NULL`, [propIds])).rows[0].n;
      assert.equal(n, 23 - 3 - 3 - 2 - 2);
      const shown = (await h.call('GET', '/review/badges', undefined, rev[2].accessToken)).body as any[];
      assert.ok(shown.every((b) => b.expiresAt && new Date(b.expiresAt) > new Date()), 'reviewers list only unexpired badges');
      assert.ok(shown.filter((b) => lapsedIds.has(b.id)).every((b) => b.tier === 't2' && b.suspended === true), 'paused video badges are marked paused');
      return `${n} video badges count; 3 expired, 3 withdrawn, 2 moved and 2 paused (T1 lapsed) do not`;
    });

    // ---------- deleting old videos ----------
    await check('Deletion job: videos 90 days after the decision are removed; younger ones, documents and the case record stay', async () => {
      const oldIds = [caseIds[1], caseIds[2], caseIds[16]];              // first-round decisions; 16 was appealed and the appeal is decided
      const youngId = caseIds[3];
      const before = (await h.pool.query(`SELECT id, status, reason_code, t2_checklist FROM verification.cases WHERE id = ANY($1) ORDER BY id`, [oldIds])).rows;
      const cx = await h.pool.connect();
      try {
        await cx.query('BEGIN'); await cx.query('ALTER TABLE verification.cases DISABLE TRIGGER USER');
        await cx.query(`UPDATE verification.cases SET decided_at = now() - interval '91 days', submitted_at = now() - interval '100 days', due_at = now() - interval '95 days' WHERE id = ANY($1)`, [oldIds]);
        await cx.query(`UPDATE verification.cases SET decided_at = now() - interval '89 days', submitted_at = now() - interval '100 days', due_at = now() - interval '95 days' WHERE id = $1`, [youngId]);
        await cx.query('ALTER TABLE verification.cases ENABLE TRIGGER USER'); await cx.query('COMMIT');
      } catch (e) { await cx.query('ROLLBACK').catch(() => {}); throw e; } finally { cx.release(); }
      const out = await retention.purge();
      assert.ok(out.retention >= 3 && out.failed === 0, JSON.stringify(out));
      for (const id of oldIds) {
        const v = videoOf.get(id)!;
        assert.equal((await h.pool.query(`SELECT status FROM supply.files WHERE id=$1`, [v.fileId])).rows[0].status, 'deleted');
        assert.equal(fake.objects.has(v.path), false, 'stored bytes are gone');
        assert.equal((await h.call('POST', `/review/cases/${id}/video/link`, undefined, rev[0].accessToken)).status, 404);
      }
      assert.equal((await h.pool.query(`SELECT status FROM supply.files WHERE id=$1`, [videoOf.get(youngId)!.fileId])).rows[0].status, 'ready');
      assert.equal(fake.objects.has(videoOf.get(youngId)!.path), true);
      const doc = propOf.get(oldIds[0])!.doc; assert.ok((await h.pool.query(`SELECT status FROM supply.files WHERE id=$1`, [doc])).rows[0].status === 'ready', 'documents untouched');
      const after = (await h.pool.query(`SELECT id, status, reason_code, t2_checklist FROM verification.cases WHERE id = ANY($1) ORDER BY id`, [oldIds])).rows;
      assert.deepEqual(after, before, 'case, decision and checklist stay');
      const kept = (await h.pool.query(`SELECT count(*)::int n FROM verification.t2_evidence WHERE case_id = ANY($1) AND start_lat IS NOT NULL AND end_lat IS NOT NULL AND video_sha256 IS NOT NULL`, [oldIds])).rows[0].n;
      assert.equal(kept, 3, 'readings and fingerprint stay');
      const ev = (await h.pool.query(`SELECT metadata FROM governance.audit_events WHERE action='verification.t2_videos_purged' ORDER BY id DESC LIMIT 1`)).rows[0].metadata;
      assert.deepEqual(Object.keys(ev).sort(), ['failed', 'retention', 'unsubmitted']);
      const again = await retention.purge(); assert.equal(again.retention, 0);
      return `${out.retention} videos deleted (3 expected, all removed); 1 video at 89 days kept; readings, fingerprint, checklist and decision kept; a second run did nothing`;
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
        const victim = (await c.query(`SELECT id FROM governance.audit_events WHERE action='verification.rejected' AND metadata ? 'checklist' ORDER BY id DESC LIMIT 1`)).rows[0].id;
        await c.query(`UPDATE governance.audit_events SET metadata = '{"reasonCode":"other"}' WHERE id=$1`, [victim]);
        const bad = (await c.query(`SELECT count(*)::int n FROM governance.audit_events WHERE hash IS DISTINCT FROM extensions.digest(coalesce(prev_hash,'\\x'::bytea) || convert_to(occurred_at::text || coalesce(actor_id::text,'') || action || subject_type || subject_id || metadata::text, 'UTF8'), 'sha256')`)).rows[0].n;
        assert.ok(bad >= 1, 'the edit is visible to the check');
        return 'direct edit refused; a forced edit of a video decision (rolled back) was detected by the hash check';
      } finally { await c.query('ROLLBACK'); c.release(); }
    });

    // ---------- speed and report ----------
    const q = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]); };
    const timing = Object.fromEntries(Object.entries(lat).map(([k, v]) => [k, { calls: v.length, p50_ms: q(v, 0.5), p95_ms: q(v, 0.95) }]));
    const report = { ranAt: new Date().toISOString(), cases: NCASE, organisations: NORG, reviewers: 3, decisions, rerecordings: rerecords, appeals, videoOpens, documentOpens: docOpens, checks, timing };
    if (process.env.S5F_REPORT) writeFileSync(process.env.S5F_REPORT, JSON.stringify(report, null, 2));
    const failed = checks.filter((c) => !c.ok);
    assert.equal(failed.length, 0, 'failed checks: ' + failed.map((c) => `${c.name} -> ${c.detail}`).join(' | '));
  } finally { delete process.env.T2_ENABLED; await h.close(); }
});
