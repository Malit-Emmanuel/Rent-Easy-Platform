/**
 * Integrity rules (S6c). Each rule is one SQL query that returns the reviewers it concerns, the figures behind it and the case numbers.
 * Parameters: $1 window (days, or minutes for "burst"), $2 minimum sample, $3 threshold.
 * A rule never sees document or video contents, and nothing here changes a case or a reviewer: the result is an advisory alert for an admin.
 * Thresholds are placeholders held in verification.integrity_rules and can be adjusted by an admin.
 */
export const STRONG_FLAGS = ['video_reused', 'location_very_far'];

const FINAL = `c.status IN ('approved','rejected') AND c.decided_by IS NOT NULL`;
const SINCE = `c.decided_at > now() - make_interval(days => $1::int)`;

export interface RuleQuery { sql: string; /** Rules without a minimum count (e.g. flagged cases) still use $2 as a floor of 0. */ cooldown: boolean }

export const RULE_QUERIES: Record<string, RuleQuery> = {
  // 1. Approving far more than peers: needs at least two peers who also have the minimum number of decisions.
  approval_rate_high: { cooldown: true, sql: `
    WITH d AS (SELECT c.decided_by r, count(*)::int n, count(*) FILTER (WHERE c.status='approved')::int a
                 FROM verification.cases c WHERE ${FINAL} AND ${SINCE} GROUP BY 1 HAVING count(*) >= $2),
         s AS (SELECT r, n, a, (100.0 * a / n)::float8 rate FROM d)
    SELECT s.r AS reviewer_id,
           jsonb_build_object('decisions', s.n, 'approvalRatePct', round(s.rate::numeric, 1), 'peerMedianPct', round(m.med::numeric, 1), 'peers', m.k, 'differencePoints', round((s.rate - m.med)::numeric, 1)) AS figures,
           '{}'::uuid[] AS case_ids
      FROM s CROSS JOIN LATERAL (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY o.rate) med, count(*)::int k FROM s o WHERE o.r <> s.r) m
     WHERE m.k >= 2 AND s.rate - m.med >= $3` },

  // 2. Deciding too fast: median time from the last document or video opening to the decision.
  too_fast: { cooldown: true, sql: `
    WITH dec AS (SELECT c.id, c.decided_by r, c.decided_at,
                        (SELECT max(l.accessed_at) FROM governance.data_access_log l
                          WHERE l.accessor_id = c.decided_by AND l.reason LIKE 'case ' || c.id::text || '%' AND l.accessed_at <= c.decided_at) last_open
                   FROM verification.cases c WHERE ${FINAL} AND ${SINCE}),
         g AS (SELECT r, count(*)::int n, percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM decided_at - last_open)) med,
                      (array_agg(id ORDER BY decided_at DESC))[1:20] ids
                 FROM dec WHERE last_open IS NOT NULL GROUP BY r)
    SELECT r AS reviewer_id, jsonb_build_object('decisions', n, 'medianSeconds', round(med::numeric, 1)) AS figures, ids AS case_ids
      FROM g WHERE n >= $2 AND med < $3` },

  // 3. Concentration: too many of a reviewer's approvals are for one organisation.
  org_concentration: { cooldown: true, sql: `
    WITH a AS (SELECT c.decided_by r, c.org_id, c.id FROM verification.cases c WHERE c.status = 'approved' AND c.decided_by IS NOT NULL AND ${SINCE}),
         t AS (SELECT r, count(*)::int n FROM a GROUP BY r HAVING count(*) >= $2),
         o AS (SELECT r, org_id, count(*)::int k, (array_agg(id))[1:20] ids FROM a GROUP BY r, org_id),
         top AS (SELECT DISTINCT ON (o.r) o.r, o.org_id, o.k, o.ids, t.n FROM o JOIN t USING (r) ORDER BY o.r, o.k DESC, o.org_id)
    SELECT r AS reviewer_id, jsonb_build_object('approvals', n, 'topOrganisationApprovals', k, 'topOrganisationSharePct', round(100.0 * k / n, 1), 'orgId', org_id) AS figures, ids AS case_ids
      FROM top WHERE 100.0 * k / n > $3` },

  // 4. Approvals later withdrawn by a different reviewer. Automatic withdrawals (e.g. the pin was moved) and a reviewer correcting themselves do not count.
  approvals_withdrawn: { cooldown: true, sql: `
    WITH a AS (SELECT c.id, c.decided_by r,
                      EXISTS (SELECT 1 FROM governance.audit_events e WHERE e.action = 'verification.badge_revoked' AND e.subject_id = c.badge_id::text
                                 AND e.actor_id IS NOT NULL AND e.actor_id <> c.decided_by AND e.occurred_at <= c.decided_at + interval '90 days') withdrawn
                 FROM verification.cases c WHERE c.status = 'approved' AND c.decided_by IS NOT NULL AND c.badge_id IS NOT NULL AND ${SINCE}),
         g AS (SELECT r, count(*)::int n, count(*) FILTER (WHERE withdrawn)::int w, (array_agg(id) FILTER (WHERE withdrawn))[1:20] ids FROM a GROUP BY r HAVING count(*) >= $2)
    SELECT r AS reviewer_id, jsonb_build_object('approvals', n, 'withdrawn', w, 'withdrawnPct', round(100.0 * w / n, 1)) AS figures, coalesce(ids, '{}') AS case_ids
      FROM g WHERE 100.0 * w / n > $3` },

  // 5. Rejections that are often overturned when appealed to another reviewer.
  appeals_overturned: { cooldown: true, sql: `
    WITH rej AS (SELECT c.id, c.decided_by r, ap.status ast
                   FROM verification.cases c JOIN verification.cases ap ON ap.appeal_of = c.id
                  WHERE c.status = 'rejected' AND c.decided_by IS NOT NULL AND ap.status IN ('approved','rejected') AND ${SINCE}),
         g AS (SELECT r, count(*)::int n, count(*) FILTER (WHERE ast = 'approved')::int ov, (array_agg(id) FILTER (WHERE ast = 'approved'))[1:20] ids FROM rej GROUP BY r HAVING count(*) >= $2)
    SELECT r AS reviewer_id, jsonb_build_object('appealedRejections', n, 'overturned', ov, 'overturnedPct', round(100.0 * ov / n, 1)) AS figures, coalesce(ids, '{}') AS case_ids
      FROM g WHERE 100.0 * ov / n > $3` },

  // 6. Strongly flagged cases that were approved: every one is listed for a second look.
  flagged_approved: { cooldown: true, sql: `
    SELECT c.decided_by AS reviewer_id, jsonb_build_object('flaggedApprovals', count(*)::int, 'flags', to_jsonb($4::text[])) AS figures, (array_agg(c.id ORDER BY c.decided_at DESC))[1:20] AS case_ids
      FROM verification.cases c WHERE c.status = 'approved' AND c.decided_by IS NOT NULL AND c.risk_flags && $4::text[] AND ${SINCE}
     GROUP BY c.decided_by HAVING count(*) > $3 AND count(*) >= $2` },

  // 7. Uniform checklist: nearly every T2 decision has all six answers "yes".
  uniform_checklist: { cooldown: true, sql: `
    WITH t AS (SELECT c.id, c.decided_by r, c.decided_at,
                      (SELECT count(*) FROM jsonb_each_text(c.t2_checklist) e WHERE e.value = 'true') = 6 AS all_yes
                 FROM verification.cases c WHERE c.tier = 't2' AND ${FINAL} AND c.t2_checklist IS NOT NULL AND ${SINCE}),
         g AS (SELECT r, count(*)::int n, count(*) FILTER (WHERE all_yes)::int u, (array_agg(id ORDER BY decided_at DESC))[1:20] ids FROM t GROUP BY r HAVING count(*) >= $2)
    SELECT r AS reviewer_id, jsonb_build_object('t2Decisions', n, 'allYes', u, 'allYesPct', round(100.0 * u / n, 1)) AS figures, ids AS case_ids
      FROM g WHERE 100.0 * u / n >= $3` },

  // 8. Bursts: more decisions inside a short window than a person can sensibly review. $1 is minutes; look-back is 30 days.
  burst: { cooldown: true, sql: `
    WITH d AS (SELECT c.id, c.decided_by r, c.decided_at FROM verification.cases c WHERE ${FINAL} AND c.decided_at > now() - interval '30 days'),
         b AS (SELECT d1.r, d1.decided_at start_at, count(d2.id)::int k, array_agg(d2.id) ids
                 FROM d d1 JOIN d d2 ON d2.r = d1.r AND d2.decided_at >= d1.decided_at AND d2.decided_at < d1.decided_at + make_interval(mins => $1::int)
                GROUP BY d1.r, d1.id, d1.decided_at),
         top AS (SELECT DISTINCT ON (r) r, k, ids, start_at FROM b ORDER BY r, k DESC, start_at)
    SELECT r AS reviewer_id, jsonb_build_object('decisionsInWindow', k, 'windowMinutes', $1::int, 'startedAt', start_at) AS figures, ids[1:30] AS case_ids
      FROM top WHERE k > $3 AND k >= $2` },

  // 9. Stale claim: a case held for longer than the threshold (hours) with no decision. Not subject to a cooldown, only to one live alert.
  stale_claim: { cooldown: false, sql: `
    SELECT c.claimed_by AS reviewer_id, jsonb_build_object('staleClaims', count(*)::int, 'oldestHeldHours', round(max(extract(epoch FROM now() - c.claimed_at)) / 3600.0)::int, 'thresholdHours', $3::numeric) AS figures,
           (array_agg(c.id ORDER BY c.claimed_at))[1:20] AS case_ids
      FROM verification.cases c WHERE c.status = 'in_review' AND c.claimed_by IS NOT NULL AND c.claimed_at < now() - ($3::numeric * interval '1 hour') AND $1::int IS NOT NULL
     GROUP BY c.claimed_by HAVING count(*) >= $2` },

  // 10. Refused attempts to claim a case from the reviewer's own organisation (information only).
  own_org_attempt: { cooldown: false, sql: `
    SELECT e.actor_id AS reviewer_id, jsonb_build_object('attempts', count(*)::int) AS figures, (array_agg(DISTINCT e.subject_id::uuid))[1:20] AS case_ids
      FROM governance.audit_events e WHERE e.action = 'verification.own_org_claim_refused' AND e.actor_id IS NOT NULL AND e.occurred_at > now() - make_interval(days => $1::int)
     GROUP BY e.actor_id HAVING count(*) >= $3 AND count(*) >= $2` },
};
