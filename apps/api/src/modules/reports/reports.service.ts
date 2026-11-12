import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { AuditService, PG_POOL } from '../audit/audit.service';
import { parseMonth, MONTH_BOUNDS } from '../../common/month';
export { parseMonth };

export const TARGET_KES = 500;
export const PLACEHOLDER_RATE_KES = 600;
const TIERS = ['t1', 't2'] as const;
const KINDS = ['reviewer_rate_per_hour', 'identity_check_fees', 'field_visits', 'other'] as const;
const TZ = 'Africa/Nairobi';
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const round = (v: number | null, d = 1) => (v === null ? null : Math.round(v * 10 ** d) / 10 ** d);

const BOUNDS = MONTH_BOUNDS;

/**
 * Admin-only reports (S6d). They describe the process and its cost. They never rank reviewers, set pay or change a case, and every view is logged.
 * Figures state their sample size. Time and cost figures cover only work recorded since the time record began (S6b).
 */
@Injectable()
export class ReportsService {
  constructor(@Inject(PG_POOL) private pool: Pool, @Inject(AuditService) private audit: AuditService) {}

  private async logView(adminId: string, resource: string, reason: string) {
    await this.pool.query(`INSERT INTO governance.data_access_log (accessor_id, resource, reason) VALUES ($1,$2,$3)`, [adminId, resource, reason]);
  }

  /** Queue and deadline report for one month, per tier, plus the queue as it stands now. */
  async queue(adminId: string, monthRaw?: unknown) {
    const month = parseMonth(monthRaw);
    const out: Record<string, unknown> = {};
    for (const tier of TIERS) {
      const q = async (sql: string) => (await this.pool.query(`WITH m AS ${BOUNDS} ${sql}`, [month, tier])).rows[0];
      const received = await q(`SELECT count(*)::int n FROM verification.cases c, m WHERE c.tier=$2 AND c.appeal_of IS NULL AND c.submitted_at >= m.s AND c.submitted_at < m.e`);
      const decided = await q(`SELECT count(*)::int n, count(*) FILTER (WHERE c.status='approved')::int approved, count(*) FILTER (WHERE c.status='rejected')::int rejected,
                                      count(*) FILTER (WHERE c.decided_at <= c.due_at)::int on_time, count(*) FILTER (WHERE c.decided_at > c.due_at)::int late
                                 FROM verification.cases c, m WHERE c.tier=$2 AND c.status IN ('approved','rejected') AND c.decided_at >= m.s AND c.decided_at < m.e`);
      const wait = await q(`SELECT count(*)::int n, percentile_cont(0.5) WITHIN GROUP (ORDER BY greatest(0, extract(epoch FROM (f.first_claim - c.submitted_at)) / 60)) med
                              FROM verification.cases c JOIN (SELECT case_id, min(claimed_at) first_claim FROM verification.review_sessions GROUP BY 1) f ON f.case_id = c.id, m
                             WHERE c.tier=$2 AND f.first_claim >= m.s AND f.first_claim < m.e`);
      const handling = await q(`SELECT count(*)::int n, percentile_cont(0.5) WITHIN GROUP (ORDER BY h.secs / 60.0) med
                                  FROM (SELECT s.case_id, sum(s.handling_seconds) secs FROM verification.review_sessions s JOIN verification.cases c ON c.id = s.case_id, m
                                         WHERE c.tier=$2 AND s.ended_at >= m.s AND s.ended_at < m.e GROUP BY s.case_id) h`);
      const returned = await q(`SELECT count(*)::int n FROM governance.audit_events e JOIN verification.cases c ON c.id::text = e.subject_id, m
                                 WHERE e.action = 'verification.needs_changes' AND c.tier=$2 AND e.occurred_at >= m.s AND e.occurred_at < m.e`);
      const appeals = await q(`SELECT count(*) FILTER (WHERE c.submitted_at >= m.s AND c.submitted_at < m.e)::int filed,
                                      count(*) FILTER (WHERE c.status IN ('approved','rejected') AND c.decided_at >= m.s AND c.decided_at < m.e)::int decided,
                                      count(*) FILTER (WHERE c.status = 'approved' AND c.decided_at >= m.s AND c.decided_at < m.e)::int overturned
                                 FROM verification.cases c, m WHERE c.tier=$2 AND c.appeal_of IS NOT NULL`);
      const nowQ = await q(`SELECT count(*) FILTER (WHERE c.status='submitted')::int waiting, count(*) FILTER (WHERE c.status='in_review')::int in_review, count(*) FILTER (WHERE c.status='needs_changes')::int needs_changes,
                                   count(*) FILTER (WHERE c.status IN ('submitted','in_review') AND c.due_at < now())::int overdue_now,
                                   count(*) FILTER (WHERE c.status='submitted' AND now() - c.submitted_at < interval '1 day')::int under_1d,
                                   count(*) FILTER (WHERE c.status='submitted' AND now() - c.submitted_at >= interval '1 day' AND now() - c.submitted_at < interval '2 days')::int d1_2,
                                   count(*) FILTER (WHERE c.status='submitted' AND now() - c.submitted_at >= interval '2 days' AND now() - c.submitted_at < interval '3 days')::int d2_3,
                                   count(*) FILTER (WHERE c.status='submitted' AND now() - c.submitted_at >= interval '3 days')::int over_3d
                              FROM verification.cases c WHERE c.tier=$2`);
      out[tier] = {
        received: received.n,
        decided: decided.n, approved: decided.approved, rejected: decided.rejected,
        medianWaitMinutes: { value: round(num(wait.med)), sampleSize: wait.n },
        medianHandlingMinutes: { value: round(num(handling.med)), sampleSize: handling.n },
        onTimePct: { value: decided.n ? round(100 * decided.on_time / decided.n) : null, sampleSize: decided.n },
        deadlineBreaches: { decidedLate: decided.late, overdueNow: nowQ.overdue_now },
        returnedForChanges: returned.n,
        appeals: { filed: appeals.filed, decided: appeals.decided, overturned: appeals.overturned },
        queueNow: { waiting: nowQ.waiting, inReview: nowQ.in_review, needsChanges: nowQ.needs_changes, waitingByAge: { under1Day: nowQ.under_1d, days1to2: nowQ.d1_2, days2to3: nowQ.d2_3, over3Days: nowQ.over_3d } },
      };
    }
    await this.logView(adminId, 'admin_report_queue', `month ${month}`);
    return { month, timezone: TZ, tiers: out, notes: ['Waiting and handling times cover only work recorded since the time record began; their sample sizes are shown.', 'Overdue-now and the queue describe the situation at the moment of the request, not the month.'] };
  }

  /** The most recent entered reviewer rate for a tier at or before the month; the placeholder if none was ever entered. */
  private async rateFor(month: string, tier: string): Promise<{ rate: number; source: 'entered' | 'placeholder'; period: string | null }> {
    const r = (await this.pool.query(
      `SELECT period::text, amount_kes FROM verification.cost_inputs_current WHERE kind='reviewer_rate_per_hour' AND tier IN ($2,'all') AND period <= ($1 || '-01')::date
        ORDER BY period DESC, (tier = $2) DESC LIMIT 1`, [month, tier])).rows[0];
    return r ? { rate: Number(r.amount_kes), source: 'entered', period: r.period.slice(0, 7) } : { rate: PLACEHOLDER_RATE_KES, source: 'placeholder', period: null };
  }

  /** Cost report for one month, per tier, against the KES 500 line. Rejections and rework are counted as cost, so the figure is not flattering. */
  async cost(adminId: string, monthRaw?: unknown) {
    const month = parseMonth(monthRaw);
    const per: Record<string, any> = {};
    for (const tier of TIERS) {
      const p = [month, tier];
      const secs = (await this.pool.query(`WITH m AS ${BOUNDS} SELECT coalesce(sum(s.handling_seconds),0)::bigint secs, count(DISTINCT s.case_id)::int cases_timed
                                             FROM verification.review_sessions s JOIN verification.cases c ON c.id = s.case_id, m WHERE c.tier=$2 AND s.ended_at >= m.s AND s.ended_at < m.e`, p)).rows[0];
      const dec = (await this.pool.query(`WITH m AS ${BOUNDS} SELECT count(*)::int decided, count(*) FILTER (WHERE c.status='approved')::int approved,
                                                  count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM verification.review_sessions s WHERE s.case_id = c.id))::int untimed
                                             FROM verification.cases c, m WHERE c.tier=$2 AND c.status IN ('approved','rejected') AND c.decided_at >= m.s AND c.decided_at < m.e`, p)).rows[0];
      const units = (await this.pool.query(`WITH m AS ${BOUNDS} SELECT count(u.id)::int n FROM supply.units u WHERE u.archived_at IS NULL AND u.property_id IN
                                              (SELECT c.property_id FROM verification.cases c, m WHERE c.tier=$2 AND c.status='approved' AND c.decided_at >= m.s AND c.decided_at < m.e)`, p)).rows[0];
      const inputs = (await this.pool.query(`SELECT kind, tier AS input_tier, amount_kes FROM verification.cost_inputs_current WHERE period = ($1 || '-01')::date AND kind <> 'reviewer_rate_per_hour'`, [month])).rows;
      per[tier] = { secs: Number(secs.secs), casesTimed: secs.cases_timed, decided: dec.decided, approved: dec.approved, untimed: dec.untimed, units: units.n, inputs };
    }
    const totalDecided = per.t1.decided + per.t2.decided;
    const outTiers: Record<string, unknown> = {};
    for (const tier of TIERS) {
      const d = per[tier]; const r = await this.rateFor(month, tier);
      const hours = d.secs / 3600;
      const reviewerCost = hours * r.rate;
      const direct = d.inputs.filter((i: any) => i.input_tier === tier).reduce((a: number, i: any) => a + Number(i.amount_kes), 0);
      const sharedTotal = per.t1.inputs.concat([]).filter((i: any) => i.input_tier === 'all').reduce((a: number, i: any) => a + Number(i.amount_kes), 0);   // 'all' inputs are the same rows for both tiers
      const shared = totalDecided ? sharedTotal * d.decided / totalDecided : 0;
      const total = reviewerCost + direct + shared;
      const per_ = (n: number) => (n > 0 ? round(total / n, 2) : null);
      const against = (v: number | null) => ({ kes: v, withinTarget: v === null ? null : v <= TARGET_KES });
      outTiers[tier] = {
        handlingHours: round(hours, 2), casesTimed: d.casesTimed, decided: d.decided, approved: d.approved, verifiedUnits: d.units,
        decidedWithoutTimeRecord: d.untimed,
        reviewerRate: { kesPerHour: r.rate, source: r.source, fromMonth: r.period },
        reviewerCostKes: round(reviewerCost, 2), otherCostsKes: round(direct, 2), sharedCostsAllocatedKes: round(shared, 2), totalCostKes: round(total, 2),
        costPerDecidedCase: against(per_(d.decided)), costPerApprovedCase: against(per_(d.approved)), costPerVerifiedUnit: against(per_(d.units)),
      };
    }
    await this.logView(adminId, 'admin_report_cost', `month ${month}`);
    return {
      month, targetKes: TARGET_KES, tiers: outTiers,
      method: 'Reviewer cost = recorded handling hours x the reviewer hourly rate. Costs typed in for "all tiers" are shared between tiers in proportion to cases decided. Rejected and returned cases are counted as cost.',
      excludes: ['developer time', 'hosting and software', 'management time', 'any cost nobody has typed in as a cost input'],
      caveats: ['Handling time covers only work recorded since the time record began; decidedWithoutTimeRecord shows how many decided cases have none.', 'If the rate source is "placeholder", no real rate has been entered yet and the reviewer cost is illustrative.'],
      notAPayBasis: 'These figures describe the process. They must not be used to pay or rank reviewers.',
    };
  }

  /** Per-reviewer activity for a month. Not ranked, and no pay or score is derived from it. */
  async reviewers(adminId: string, monthRaw?: unknown) {
    const month = parseMonth(monthRaw);
    const rows = (await this.pool.query(
      `WITH m AS ${BOUNDS},
            d AS (SELECT c.decided_by r, count(*)::int decisions, count(*) FILTER (WHERE c.status='approved')::int approved, count(*) FILTER (WHERE c.status='rejected')::int rejected
                    FROM verification.cases c, m WHERE c.status IN ('approved','rejected') AND c.decided_by IS NOT NULL AND c.decided_at >= m.s AND c.decided_at < m.e GROUP BY 1),
            s AS (SELECT s.reviewer_id r, count(*)::int sessions, sum(s.handling_seconds)::bigint secs, count(*) FILTER (WHERE s.end_reason='sent_back')::int sent_back,
                         count(*) FILTER (WHERE s.end_reason IN ('released','admin_released'))::int released
                    FROM verification.review_sessions s, m WHERE s.ended_at >= m.s AND s.ended_at < m.e GROUP BY 1),
            a AS (SELECT reviewer_id r, count(*)::int alerts FROM verification.integrity_alerts, m WHERE raised_at >= m.s AND raised_at < m.e GROUP BY 1)
       SELECT coalesce(d.r, s.r) reviewer_id, '…' || right(u.phone, 3) AS account, coalesce(d.decisions,0) decisions, coalesce(d.approved,0) approved, coalesce(d.rejected,0) rejected,
              coalesce(s.sessions,0) sessions, coalesce(s.secs,0) secs, coalesce(s.sent_back,0) sent_back, coalesce(s.released,0) released, coalesce(a.alerts,0) alerts
         FROM d FULL JOIN s ON s.r = d.r LEFT JOIN a ON a.r = coalesce(d.r, s.r) JOIN identity.users u ON u.id = coalesce(d.r, s.r) ORDER BY coalesce(d.r, s.r)`, [month])).rows;
    await this.logView(adminId, 'admin_report_reviewers', `month ${month}: ${rows.length} reviewers`);
    return {
      month, notRanked: true,
      note: 'Listed by account, not by performance. Approval rate with a small sample means little; the sample size is shown. No pay or ranking is derived from this report.',
      reviewers: rows.map((r) => ({
        reviewerId: r.reviewer_id, account: r.account, decisions: r.decisions, approved: r.approved, rejected: r.rejected,
        approvalRatePct: r.decisions ? round(100 * r.approved / r.decisions) : null, sampleSize: r.decisions,
        sessions: r.sessions, handlingHours: round(Number(r.secs) / 3600, 2), sentBack: r.sent_back, released: r.released, alertsRaised: r.alerts,
      })),
    };
  }

  // ---- Cost inputs: typed in by an admin; the system never guesses ----
  async addCostInput(adminId: string, body: { period?: unknown; tier?: unknown; kind?: unknown; amountKes?: unknown; note?: unknown }) {
    const month = parseMonth(body?.period ?? '__missing__');
    if (!['t1', 't2', 'all'].includes(body?.tier as string)) throw new BadRequestException('tier must be t1, t2 or all');
    if (!(KINDS as readonly string[]).includes(body?.kind as string)) throw new BadRequestException(`kind must be one of ${KINDS.join(', ')}`);
    const amount = body?.amountKes;
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount > 1e9) throw new BadRequestException('amountKes must be a number from 0 up');
    const note = typeof body?.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 500) : null;
    if (body.kind === 'other' && !note) throw new BadRequestException('Say what an "other" cost is in the note.');
    const r = await this.pool.query(`INSERT INTO verification.cost_inputs (period, tier, kind, amount_kes, note, created_by) VALUES (($1 || '-01')::date,$2,$3,$4,$5,$6) RETURNING id`, [month, body.tier, body.kind, amount, note, adminId]);
    await this.audit.record({ actorId: adminId, action: 'cost.input_recorded', subjectType: 'cost_input', subjectId: r.rows[0].id, metadata: { period: month, tier: body.tier, kind: body.kind, amountKes: amount } });
    return { id: r.rows[0].id };
  }

  /** Every entry for a month, newest first, so a correction is visible next to what it replaced. */
  async listCostInputs(adminId: string, monthRaw?: unknown) {
    const month = parseMonth(monthRaw);
    const rows = (await this.pool.query(`SELECT id, tier, kind, amount_kes, note, created_by, created_at FROM verification.cost_inputs WHERE period = ($1 || '-01')::date ORDER BY created_at DESC, id DESC`, [month])).rows;
    await this.logView(adminId, 'admin_cost_inputs', `month ${month}: ${rows.length}`);
    return { month, placeholderRateKes: PLACEHOLDER_RATE_KES, inputs: rows.map((r) => ({ id: r.id, tier: r.tier, kind: r.kind, amountKes: Number(r.amount_kes), note: r.note, enteredBy: r.created_by, enteredAt: r.created_at })) };
  }
}
