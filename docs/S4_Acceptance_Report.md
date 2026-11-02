# S4 Acceptance Report: Property Review Queue and T1 Badge

Run date: 2 November 2026. Prepared for founder sign-off. Covers S4 steps 1 to 6 as deployed (latest commit `8751f99`).

## 1. Result in one paragraph

The 50-case acceptance run passed all 15 checks. Fifty test cases went through three reviewers and five organisations over the real API, including 10 appeals, 8 "needs changes" round trips, 3 badge withdrawals and 3 badge expiries. Every decision has a reason, no reviewer touched a case of an organisation they belong to, every document open was logged exactly once, and the audit chain verified with no broken links and no wrong hashes. The same database rules also passed on the live Supabase database, and the live audit chain verified.

## 2. What was run, and where

| Run | Where | Result |
|---|---|---|
| 50-case acceptance run (15 checks) | Local copy of the system | 15 of 15 pass |
| API test suite | Local copy | 211 of 211 pass |
| Dashboard test suite and build | Local copy | 19 of 19 pass, build clean |
| Database rule tests (59 rules) | Local copy | 59 passed, 0 failed |
| Database rule tests, S4 and audit rules (33 rules), rolled back | Live Supabase | 33 passed, 0 failed, nothing left behind |
| Audit chain check on live data | Live Supabase | 61 events, 0 broken links, 0 wrong hashes |
| Manual run in the browser on zurihome.app | Live | Request, claim, open documents, approve: worked, badge valid to 2 November 2027 |

## 3. The 50-case run

Setup: 5 test organisations, 50 properties each with a title deed and an authorisation letter, 3 reviewers outside every organisation, and 1 reviewer who belongs to organisation 0. Ten cases were made overdue and some made due soon, to test ordering.

Planned outcomes and what happened:
- 25 approved first time.
- 10 rejected with a reason, then appealed: 5 appeals approved, 5 rejected (final).
- 8 sent back as "needs changes", fixed by the manager (new document added), resubmitted, then approved.
- 7 rejected with a reason, no appeal.

Totals: 68 reviewer decisions, 8 resubmissions, 10 appeals, 144 documents opened. 38 properties ended verified, 12 ended not verified.

## 4. The checks

| # | Check | Result |
|---|---|---|
| 1 | Queue order: overdue first, then due date, then risk, then age | Pass: 50 cases, the 10 overdue first, due dates never go backwards |
| 2 | No self-review: a reviewer inside organisation 0 sees none of its 10 cases and cannot claim them | Pass: 10 of 10 claims refused; the other 40 cases still visible |
| 3 | All 50 cases decided, nothing left open | Pass |
| 4 | Every rejection and needs-changes decision has a reason code; "other" always has a note | Pass, in the case rows and in the audit trail |
| 5 | No reviewer decided or claimed a case of their own organisation | Pass: 0 violations |
| 6 | Appeals: one per rejected case, decided by a different reviewer, never appealed again | Pass: 10 appeals, 0 by the same reviewer, 0 repeated, a second appeal after a final decision refused |
| 7 | Human decisions only: every approval and rejection traces to a named reviewer in the audit trail | Pass: no automatic decisions |
| 8 | Document access: holder only, five-minute links, every open logged | Pass: 144 opens = 144 access-log rows = 144 audit events; links refused to managers, signed-out callers and, once decided, to every reviewer |
| 9 | Evidence frozen: documents of decided cases cannot be deleted | Pass: 8 of 8 deletions refused |
| 10 | Request audit: all 50 requests recorded | Pass (see limits below on the deadline rule) |
| 11 | Badges last about 12 months | Pass: 38 badges, all 364 to 367 days |
| 12 | Revoking needs a reason; 3 withdrawn with different reasons; a reviewer inside the organisation is refused | Pass |
| 13 | Expired and withdrawn badges never count on any screen | Pass: 32 verified, 18 not; the 3 expired and 3 withdrawn all show as not verified |
| 14 | Audit chain: every link joins and every hash recomputes | Pass: 1,476 events, 0 broken links, 0 wrong hashes |
| 15 | A tampered record is detected and the audit table refuses edits | Pass: direct edit refused; a forced edit (rolled back) was caught by the hash check |

Speed on the local copy (median and slowest 5%): request 13 ms and 22 ms, queue 8 ms and 15 ms, claim 8 ms and 13 ms, decision 8 ms and 14 ms, document link 6 ms and 10 ms. Production over the network will be slower, but nothing here is close to a problem.

## 5. Limits of this run: read before signing off

1. **Local copy, not live.** The 50 cases ran on a local copy so test data would not enter production. That copy uses a stand-in for PostGIS, fake file storage and a fake SMS sender. The database rules and the audit chain were additionally checked on the live database.
2. **The deadline rule is only partly covered here.** The 2-working-day rule is covered by unit tests and the request test, not by the 50-case run itself (the run moved some deadlines on purpose to test ordering).
3. **Not yet tried in a browser on the live system:** reject, needs changes with "send back for review", the appeal, and withdrawing a badge. They are covered by the automated tests above.
4. **One reviewer.** Only one real reviewer account (the number ending 477) exists. Appeals need a different reviewer, so the appeal route cannot be used live until a second real reviewer is added.
5. **Document links were fake in the run.** Real Supabase Storage links were checked during the file-upload stage (S2), not in this run.
6. **Proof rules are a placeholder.** What counts as sufficient proof (title deed or lease, plus a letter of authority unless the organisation is the landlord) is a placeholder until your advocate confirms it.
7. **Real documents.** Use test files only until the advocate confirms how real documents may be handled.

## 6. Launch gates still open (not technical)

- Company registration.
- A named advocate to confirm the proof rules and document handling.
- Named pilot managers.
- A second real reviewer.
- A real SMS provider, so managers receive sign-in codes and status messages by phone.

## 7. Recommendation

S4 is technically complete and passes its own acceptance criteria. Recommend signing off S4 for the pilot-preparation phase and treating the gates in section 6 as the conditions for going live with real documents.

## 8. Next steps if signed off

S5 (T2 video and location checks) and S6 (reviewer pattern alerts, time tracking and the cost-per-badge report), each starting with a design note for your approval, as with S4.
