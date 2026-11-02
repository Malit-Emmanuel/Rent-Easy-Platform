# S5 Design Note: T2 Badge (Video and Location)

Prepared 2 November 2026 for founder sign-off. Part of B3 (Supply Core and Verification). Nothing in S5 is built yet.

## 1. What S5 is, in plain words

T1 answers "does this manager have the right to offer this building?" from documents. **T2 answers a different question: "is this building really there, and was the manager actually standing at it?"**

To earn a **T2 "video" badge** (valid 6 months), a manager records a short, live walkthrough at the property using their phone. The platform also takes two location readings from the phone. A trained reviewer watches the video, checks it against the address, the map and the T1 documents, and decides.

Everything is still decided by a person. The computer only does arithmetic (distances, times, duplicates) and shows the results as hints. There is no automatic or AI approval and no AI analysis of the video.

## 2. The journey

**Manager (property page, the Verification card)**
1. The property already has a valid T1 badge. A button appears: **Upgrade to T2**.
2. A short notice says what is recorded (video, sound, two location readings), who can see it, and how long it is kept. The manager agrees. The agreement is recorded.
3. The platform issues a **one-time challenge** valid for 30 minutes:
   - a 4-digit code to say aloud at the start of the video, together with today's date;
   - one or two **randomly chosen units** to show inside (so nobody can film a nicer unit than the one listed).
4. **Record walkthrough**: the browser asks for camera, microphone and location. The manager records 30 to 90 seconds: say the code, show the entrance and street, the stairs or compound, and the chosen unit(s). They can watch it back and retake (up to 3 takes). Only the submitted take is kept; the others are deleted.
5. **Submit.** A T2 case is created. Status chips work as for T1: *In review, Needs changes, Verified until [date], Rejected (reason), Appeal in review.*

**Reviewer (same queue, same case page)**
1. T2 cases appear in the existing queue, marked T2, with a 3-working-day deadline.
2. Claim, then open the evidence. Each video open creates a 5-minute link that is written to the access log, exactly like documents. **The video must be opened before an approval is allowed.**
3. The case page shows a **T2 evidence panel**:
   - the video;
   - the challenge (code, date, units to show) and whether the video was made inside the 30-minute window;
   - the two location readings against the property's recorded position: distance, and the phone's own accuracy figure;
   - a checklist (below) and the hints (below).
4. Decide: **Approve** (T2 badge, 6 months), **Needs changes** (manager must record again with a new challenge; the clock pauses), or **Reject** with a reason code. One appeal, a different reviewer, final.

## 3. The reviewer checklist (every item answered yes or no)

1. I heard the correct code and date.
2. The entrance and street match the address and map.
3. The unit(s) shown are the ones the platform chose.
4. The footage looks continuous (no cuts, no filming of another screen).
5. The location readings are close to the recorded position.
6. The place matches the address on the T1 documents.

A "no" does not block anything by itself. It forces the reviewer to choose Needs changes or Reject with a reason. Answers are saved with the decision.

## 4. Computed hints (advisory only, never decide)

| Hint | Why |
|---|---|
| Distance from each reading to the property position | Basic "were they there" check. Looks right within 100 m plus the phone's reported accuracy (up to 100 m). Flagged beyond that. Strongly flagged beyond 300 m |
| The two readings disagree with each other | Possible fake or moved location |
| Reading equals the property pin to 5 decimals | Looks typed, not measured |
| Same video bytes seen on another property or earlier case | Reused video (checked with a fingerprint of the file) |
| Same coordinates on different properties | Copied position |
| Challenge time versus upload time | Window exceeded or very slow upload |

## 5. Rules that protect trust

- **T2 needs a valid T1.** A T2 badge only counts while the T1 badge is also valid. If T1 expires or is revoked, the property shows no T2.
- **Live recording only.** Videos picked from the phone's gallery are not accepted in v1. That is what makes the code and the 30-minute window mean something.
- **The property position is frozen while a T2 case is open**, so the pin cannot be moved to match the readings. After approval, moving the pin by more than 100 m ends the T2 badge (T1 stays) and is audited.
- **One open case per property**, **no self-review**, **appeal to a different reviewer**, **evidence is frozen**, **managers never see which reviewer decided**, **every read and decision is logged**: all as in S4.
- **Needs changes means a new challenge.** An old video can never be resubmitted against a new code.
- **Limited data.** Two location readings per recording, never continuous tracking. The video is private and opened only through short, logged links.
- **Test videos only** until your advocate confirms how video and location data may be handled.

## 6. Reason codes (added to the S4 list)

| Code | Meaning |
|---|---|
| `t2_code_missing` | The code or date is not spoken, or is wrong |
| `t2_location_mismatch` | Readings do not fit the property position |
| `t2_property_mismatch` | The place shown is not the address or documents |
| `t2_unit_not_shown` | The chosen unit(s) were not shown |
| `t2_video_unusable` | Too dark, too short, no sound, or cannot be played |
| `t2_suspected_replay` | Signs of reused, edited or screen-recorded footage |

`suspected_forgery` and `other` (note required) from S4 also apply.

## 7. What T2 does NOT prove (please read)

- A phone location reading is reported by the phone. A determined person with a location-spoofing app could fake it. The code, the random unit, the live-only rule and the reviewer's eyes are what catch that. T2 is **stronger evidence, not proof**.
- The recorded position is typed by the manager. "Their phone was near their own pin" proves little alone. The real check is the reviewer comparing the video, the street, the map and the T1 documents (checklist items 2 and 6).
- It proves the manager had access on the day. It does not prove ownership; that is T1.

## 8. What gets added

**Database (migration 0013; applied migrations are never edited)**
- Allow tier `t2` on cases (today only `t1`).
- `verification.t2_challenges`: code, chosen units, issued and expiry time, who asked, used or not.
- `verification.t2_evidence`: links the case to the video file, the two location readings (latitude, longitude, accuracy, time), the agreement time, the file fingerprint, and the reviewer's checklist answers.
- New reason codes; case page uses the existing `t2_video` badge level; badge life 6 months.
- Rule tests: T2 needs valid T1; one challenge per open case; used or expired challenges cannot be reused; evidence frozen once submitted; reviewer's approval requires video opened; position-change rule.

**API**
- Manager: request challenge, upload through the existing signed-upload path, submit with readings, resubmit.
- Reviewer: T2 evidence, open video (logged), save checklist, decide.
- Daily job: delete raw videos once the retention period after the final decision has passed (the decision, reason, readings and checklist stay).

**Screens**
- Manager: T2 section on the Verification card with the notice, challenge, in-browser recorder (watch back, retake, submit) and status chips.
- Reviewer: T2 evidence panel on the case page and a T2 marker in the queue and history.
- Swahili and English throughout (Swahili needs a native-speaker review).

## 9. Practical limits to know about

- **Phones record big files.** A normal phone-camera video can be 100 MB a minute. The recorder therefore runs inside the page at a modest quality (about 10 to 15 MB for 60 seconds), which fits the current 45 MB limit.
- **Browsers.** Recording works in current Chrome (Android) and Safari (iPhone). It often fails inside the in-app browsers of WhatsApp, Instagram and similar apps; the page will tell people to open it in Chrome or Safari.
- **Storage.** Videos fill the storage plan faster than documents. The retention job keeps this bounded. Check the plan limit before the pilot.
- **Poor signal.** Uploads on weak networks can fail. The 30-minute window allows retries; a new challenge can be requested after it expires.
- **Safety.** Managers are told not to film people or number plates and to record only at the property. Reviewers are told to stop and report if footage shows people in distress or anything illegal. (Wording to be confirmed with your advocate.)

## 10. Build stages (sign-off after each, as in S4)

| Stage | Delivers |
|---|---|
| S5a | Migration 0013, rules and database tests |
| S5b | Challenge and submission API, hints, tests |
| S5c | Manager recorder and notice |
| S5d | Reviewer evidence panel, checklist, decisions |
| S5e | T2 badge status, expiry, T1 dependency, position rule, retention job |
| S5f | Acceptance run (30 T2 cases, plus replay, location, expiry, appeal and audit-integrity checks) and report |

You will need to try S5c on a real phone, at a real building, with test footage only.

## 11. Decisions I need from you

| # | Decision | My suggestion |
|---|---|---|
| 1 | T2 only after a valid T1 | Yes |
| 2 | Live recording only, no gallery uploads in v1 | Yes. Devices that cannot record keep T1 until the field app (B3F) exists |
| 3 | Distance rule: looks right within 100 m plus phone accuracy; flagged beyond; strongly flagged beyond 300 m | Yes, advisory only. Adjust after real readings |
| 4 | Video retention: delete raw video 90 days after the final decision. Readings, checklist and decision stay with the case | Yes as a placeholder until your advocate advises |
| 5 | Random units to show: 1 unit up to 10 units, 2 units above that | Yes |
| 6 | Moving the property pin by more than 100 m after approval ends T2 | Yes |

Already agreed in the B3 brief: T2 review within 3 working days and T2 badge life of 6 months.

## 12. What I need from your side

- Your reply on the six decisions above (or "go with your suggestions").
- Your advocate's view on filming and location data before any real video is used.
- A phone, a building you may film (a test building, not a stranger's home) and about 15 minutes when S5c is ready.
- The open launch gates from S4 still stand: company registration, named advocate, pilot managers, a second real reviewer, and a real sign-in provider.
