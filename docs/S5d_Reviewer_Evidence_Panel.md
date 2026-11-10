# S5d: Reviewer Evidence Panel and T2 Decisions

Status: built and tested. Nothing is live until the patch is pushed and `T2_ENABLED=true` is set on purpose.

## What a reviewer can now do
1. **See T2 cases in the same queue**, marked "Video (T2)", due in 3 working days, ordered like T1. The computer's notes (for example "Location very far") show as small tags. They change the order only.
2. **Claim, then open the case.** The case page has a *Video and location evidence* panel:
   - the code the manager had to say, the date, and the unit(s) they had to show;
   - whether the recording started inside the 30-minute window, and how late it was sent;
   - which recording this is (a "needs changes" round shows "Recording 2 of 2"; only the latest is reviewed);
   - two location readings, each with distance from the property position, the phone's own accuracy, and an "Open on a map" link (the link opens a public map only when the reviewer clicks it);
   - the computer's notes, labelled as advice only.
3. **Watch the video.** The button creates a 5-minute link, plays the video in the page, and writes the access to the access log and the audit trail (file id only, no code, no coordinates).
4. **Answer the six-item checklist** (code heard, place matches address, units shown, footage continuous, location close, place matches documents). Every item must be answered on every decision.
5. **Decide**: Approve (6-month video badge), Needs changes (manager records again with a new code), or Reject with a reason.

## Rules that protect people
- **A person decides.** Computed checks never approve or reject. A "no" on the checklist does not decide anything either; it only stops an approval.
- **Approval needs**: the video watched (the latest recording, by this reviewer, on this case), every attached document opened, six "yes" answers, a valid T1 badge at that moment. The server checks all of these; the database checks the checklist and the T1 again.
- **Stricter than the design note** (one deliberate addition): approval also needs every attached T1 document opened, because checklist item 6 compares the place with those documents.
- **Reasons on a T2 case**: the six video reasons plus "suspected forgery" and "other" (note required). Document-only reasons are refused on a video case; video reasons are refused on a T1 case (also enforced by the database).
- **No self-review, one holder at a time, appeals to a different reviewer** work exactly as for T1. An appeal shows the same recording the first reviewer saw.
- **Managers never see who decided or the computer's notes.** They see the reason and the note, as before.
- **The checklist answers are kept** in the audit trail with the decision (they are cleared from the case when the manager resubmits, so the trail is the permanent record).
- **If T1 lapses before the decision**, approval is refused with a clear message; the reviewer can still choose Needs changes or Reject.
- Safety line shown on the panel: if footage shows people in distress or anything illegal, do not approve; reject and tell your lead. (Wording to be confirmed with the advocate.)

## What changed in the code
- API: `review.service.ts` (queue and claim include T2, `t2` block in the case detail, `openVideo`, tier-aware `decide`), `review.controller.ts` (`POST review/cases/:id/video/link`), `t2.rules.ts` (`checkT2Decision`, `T2_REASON_CODES`, `T2_CHECKLIST`, `t2BadgeExpiry`).
- Web: `T2EvidencePanel.tsx`, `lib/t2review.ts`, the case, queue and history pages, English and Swahili strings, small CSS additions.
- No database migration in this step (S5a and S5b already hold the tables and guards).

## Test results
- API 275/275 (new: a 12-step HTTP test of the whole reviewer path, rule unit tests; one old assertion updated because T2 cases now reach the queue).
- Database rules 130/0. Web unit tests 32/32. Production build clean.
- Phone-size and desktop screenshots checked; checklist gating exercised in a browser with a mocked server.

## Known limits (honest list)
- **T2 badge withdrawal by a reviewer, expiry handling, T1 dependency after approval, the position-change rule and the 90-day video deletion job are S5e.** Until then videos are not deleted automatically.
- The map link sends a coordinate to a public map service when clicked. If the advocate dislikes this, we can remove it.
- Swahili strings still need review by a native speaker.
- Location is reported by the phone and can be faked: T2 is stronger evidence, not proof.
- Real videos stay disabled (`T2_ENABLED` off) until legal clearance.
