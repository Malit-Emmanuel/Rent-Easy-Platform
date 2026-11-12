# S6f Acceptance Report: reviewer integrity and cost reporting

Date: 12 November 2026. Scope: S6a to S6e (time record, integrity rules, admin release of stale claims, reports, oversight screens, reviewer statistics).

## Result

All checks pass. Nothing in S6 changes a case outcome, a badge or a role by itself: people decide, the oversight tools only show figures and raise advisory alerts.

| Check | Result |
|---|---|
| Acceptance run (`s6.acceptance.http.test.ts`): 12 checks | 12 / 12 passed |
| Full API suite | 322 / 322 passed |
| Database rules: portable / S5E / S6A (each on a freshly built database) | 130 / 0, 20 / 0, 39 / 0 failed |
| Live Supabase, read-only | audit chain intact; migration 0016 objects present; see below |

## How the run was done

Three reviewer accounts, one manager organisation, one admin account and one reviewer who belongs to the manager organisation (to test the own-organisation rule). Twelve documented (T1) cases were submitted by the manager and worked through the real endpoints: claim, open every document, approve, reject, send back for changes, release, and a stale claim. The claim time was moved back in the database to stand in for waiting (a test cannot wait hours). Expected figures were kept by the test as the work was done, then compared with the reports. Because the reports cover a whole month, each report figure was compared as "after minus before".

## What was checked

1. **Time record.** One record for every finished stretch: decided, sent back, released. A case released and then decided by another reviewer has two records, one for each person. 45 minutes elapsed counted as 30 minutes of handling; a 3-hour walk-away counted as 30; the full elapsed time is kept alongside. A claim still running writes nothing until it ends.
2. **Own organisation.** A reviewer who belongs to the submitting organisation gets the same plain "not found", the case stays in the queue, and the attempt is recorded against the account.
3. **Reviewer figures.** Decisions, approvals, sent back, released and handling hours for each of the three reviewers match the test's own counts, in the admin report and on each reviewer's own statistics page.
4. **Queue report.** Received (+12), decided (+7: 5 approved, 2 rejected), returned for changes (+1) and the number waiting match the independent counts.
5. **Cost report.** Reviewer cost equals handling time multiplied by the rate; total and cost per decided case follow; the KES 500 line is shown per tier; T2 is shown separately; the "not a basis for pay or ranking" notice is present. The rate on the clean run was the KES 600 placeholder, labelled as a placeholder.
6. **Admin only.** All seven admin screens (queue, cost, reviewers, cost inputs, alerts, rules, stale claims) refuse reviewers, managers and signed-out callers. The reviewers' statistics page refuses the admin account (it belongs to reviewers). Admin report views are written to the data access log.
7. **Stale claim.** Listed after 4 hours; a 10-minute claim is not listed; nothing is released automatically; the admin must give a reason (5 to 500 characters); a fresh claim cannot be released this way; the release is recorded with the admin as actor; the case goes back to the queue and another reviewer can claim it.
8. **Alerts advisory.** The daily scan ran all 10 enabled rules. A fingerprint of every case, badge and role was identical before and after the scan, and after an admin handled an alert. Reviewers could keep working. A reviewer cannot handle an alert. The three second-look rules stay off and refuse to be switched on.
9. **Own statistics only.** The reviewer's page returns that reviewer's figures only: no other reviewer, no ranking.
10. **Outcomes.** All twelve cases ended exactly as the human decisions, or lack of them, dictate.
11. **Audit chain.** Every link joins to the one before and every hash recomputes (76 events on the clean run; 4,226 on the long-used local database).
12. **Append-only.** The database refuses edits and deletes on the time record and the audit table.

## Live Supabase (read-only)

- Audit chain: 88 events, 0 broken links, 0 wrong hashes.
- Migration 0016 is present: 13 integrity rules, 10 on, second-look rules 0 on.
- No `super_admin` account exists yet, as you decided. The oversight screens therefore refuse everyone in production.
- Review sessions, alerts, second looks and cost inputs are all empty (no real review work has been recorded since S6b), and no stale claims.
- Supabase security advisor: only "RLS enabled, no policies" notices (37 tables). This is intentional: the API connects as the owner and the public roles have no access.

## Not tested, and why

- **Real alerts about real reviewers.** There is one real reviewer, so peer comparison and second looks cannot be shown live. The rules are tested on fixtures (S6c).
- **Real elapsed waiting.** Claim times were moved back; the capping and recording logic is real.
- **Production admin screens.** They cannot be opened until a `super_admin` account is chosen.

## Known limits (unchanged)

Figures cover work recorded since S6b. The reviewer rate is a KES 600 placeholder until you enter the real one. Alert and time-record retention (24 months) is a placeholder for counsel to confirm. Swahili wording on the new screens needs a native speaker. The second-look workflow is not built. Real videos stay disabled until legal clearance. Reviewers must be told what is measured (briefing items G3 and H1) before any real reviewer is monitored.

## Open items for you

Register the company; follow up with the lawyer (briefing, data protection pack, four retention questions, and what reviewers must be told about measurement); shortlist ID providers; open Africa's Talking; start Meta business verification and the `zuri_login_code` template; set keys as Railway variables yourself; keep `T2_ENABLED` off; find a second and third real reviewer; enter the real hourly rate; have the Swahili reviewed; choose the account to receive `super_admin` when ready.
