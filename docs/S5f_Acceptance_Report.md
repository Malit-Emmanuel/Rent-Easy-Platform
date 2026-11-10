# S5f Acceptance Report: Video and Location Verification (T2)

Run date: 10 November 2026. Prepared for founder sign-off. Covers S5a to S5e as deployed (Railway commit `2b54a89`, Vercel build ready).

## 1. Result in one paragraph

The 30-case video acceptance run passed all 24 checks. Thirty properties went through five organisations and three reviewers over the real API, including 6 appeals, 4 "record again" round trips, 2 re-sent videos (replay) and 2 recordings made far from the property. Every decision was made by a named person with a reason and a six-question checklist. The system flagged all 4 suspicious recordings and nothing else, and decided none of them itself. Video badges expired, were withdrawn, paused when T1 lapsed and ended when the pin moved, exactly as designed. Old videos were deleted after 90 days while the case record stayed. The audit chain verified with no broken links, and the live database's chain verified too.

## 2. What was run, and where

| Run | Where | Result |
|---|---|---|
| 30-case video acceptance run (24 checks) | Local copy of the system | 24 of 24 pass |
| API test suite (includes the run above) | Local copy | 286 of 286 pass |
| Dashboard test suite and build | Local copy | 32 of 32 pass, build clean |
| Database rule tests | Local copy | 130 passed, 0 failed; S5e rules 20 passed, 0 failed |
| Live database read-only checks | Live Supabase | Audit chain 88 events, 0 broken links, 0 wrong hashes; S5e triggers, view, reason code and 90-day setting present; nothing wrongly queued for deletion |
| Security advisor on live | Live Supabase | Only the expected "RLS on, no policies" notices (the API connects as owner) |
| S5e deployed | Railway and Vercel | Both live and started cleanly |

## 3. The 30-case run

Setup: 5 test organisations, 30 properties each with a pin, a unit, a title deed and a valid T1 badge, 3 reviewers outside every organisation, and 1 reviewer who belongs to organisation 0. Six cases were made overdue and some made due soon, to test ordering.

Planned outcomes and what happened:
- 16 approved first time.
- 6 rejected with a reason, then appealed: 3 appeals approved, 3 rejected (final).
- 4 sent back ("record again"), re-recorded by the manager, then approved.
- 2 re-sent the exact video of earlier cases (replay): flagged, then rejected by a reviewer.
- 2 recorded about 22 km from the pin (location): flagged strongly, then rejected by a reviewer.

Totals: 40 reviewer decisions, 4 re-recordings, 6 appeals, 40 videos and 40 documents opened. 23 properties ended video verified.

## 4. The checks

| # | Check | Result |
|---|---|---|
| 1 | Queue: all cases marked as video cases, overdue first, then due date | Pass: 30 cases, 6 overdue first |
| 2 | No self-review: an insider sees, claims or opens none of their organisation's cases | Pass: 6 of 6 refused for claim, video link and case page |
| 3 | Replay: re-sent videos are flagged | Pass: 2 of 2 flagged, 0 false alarms in the other 28 |
| 4 | Location: far recordings flagged strongly | Pass: 2 of 2 flagged; no other location flags |
| 5 | Hints advise only: flagged cases stay open until a person decides | Pass: 4 of 4 untouched by the system |
| 6 | All cases decided, nothing left open | Pass |
| 7 | Every rejection and send-back has a video reason; "other" has a note | Pass, in the case rows and in the audit trail |
| 8 | Six-question checklist saved on every decision; every approval has six yeses | Pass: 40 decisions |
| 9 | Human decisions only: every approval and rejection traces to the reviewer who made it | Pass: no automatic decisions |
| 10 | No reviewer decided or claimed a case of their own organisation | Pass: 0 violations |
| 11 | Appeals: one per rejected case, a different reviewer, never repeated | Pass: 6 appeals, 0 by the same reviewer; a second appeal refused |
| 12 | Video access: holder only, five-minute links, every open logged once; decided cases hand out nothing | Pass: 40 opens = 40 log rows = 40 audit events |
| 13 | Managers never see hints, distances, flags, fingerprints or who decided | Pass: 30 pages checked |
| 14 | Location: exactly two readings per recording, no coordinates or codes in the audit trail | Pass: 34 recordings |
| 15 | Evidence frozen: managers cannot delete the video of a decided case | Pass: 8 of 8 refused |
| 16 | Recording rules: spent code, expired window, no consent, fourth take, bad readings, no T1 | Pass: all refused |
| 17 | Kill switch: with video checks off, no new recording can start | Pass |
| 18 | Video badges last about 6 months, each with a valid T1 and a remembered approved position | Pass: 23 badges, 178 to 186 days |
| 19 | Withdrawing a video badge needs a video reason; insiders refused | Pass: 3 withdrawn, suspected replay flagged |
| 20 | Moving the pin more than 100 m ends the video badge, not T1; a 50 m correction does not | Pass: 2 ended and audited, 1 kept |
| 21 | Expired, withdrawn, moved and T1-lapsed badges never count | Pass: 13 count; 3 expired, 3 withdrawn, 2 moved, 2 paused do not |
| 22 | Deletion job: 90-day-old videos removed; younger ones, documents and case records stay | Pass: 3 deleted, 1 at 89 days kept, second run did nothing |
| 23 | Audit chain: every link joins and every hash recomputes | Pass: 821 events, 0 broken, 0 wrong |
| 24 | A tampered record is detected and the audit table refuses edits | Pass |

Speed on the local copy (median and slowest 5%): challenge 9 ms and 17 ms, submit 11 ms and 16 ms, queue 5 ms and 14 ms, claim 5 ms and 11 ms, decision 6 ms and 13 ms, video link 5 ms and 11 ms. Production over the network will be slower, but nothing here is close to a problem.

## 5. Limits of this run: read before signing off

1. **Local copy, not live.** The cases ran on a local copy so test data would not enter production. It uses a stand-in for PostGIS, fake file storage and a fake SMS sender. On the live database only read-only checks were run.
2. **Replay detection is exact-copy only.** A re-sent file is caught because its fingerprint matches. A video that has been re-encoded, trimmed or filmed off another screen has a different fingerprint and is **not** caught by the system. That is what the reviewer's footage-continuity and code-heard questions are for.
3. **Location can be spoofed.** The phone's position is self-reported. Readings and hints are stronger evidence, not proof. The run tests the rules around them, not the honesty of a phone.
4. **Real videos were not used.** The run uses small test files. Real phone video, real signal and the in-browser recorder were tried only in your earlier phone test.
5. **Not yet tried by hand on the live system:** reject, appeal, withdrawing a video badge, and the new "paused" and "renew" messages. Automated tests cover them.
6. **One real reviewer.** Appeals need a different reviewer, so the appeal route cannot be used live until a second real reviewer exists.
7. **Swahili text needs a native speaker's review.**
8. **Video checks stay switched off** (`T2_ENABLED`) until legal clearance. The run switched them on only inside the test.

## 6. Decisions and risks still open

- 90-day video retention is provisional until the advocate confirms it, as is keeping the video fingerprint longer than the video.
- Videos for "record again" cases that a manager never answers stay indefinitely: an end date is needed.
- T1 documents have no retention end date yet.
- Location rule thresholds (100 m, 300 m) are placeholders to adjust after real readings.

## 7. Recommendation

Accept S5 as built, for testing only, with video checks left off until the legal items in section 6 are settled.
