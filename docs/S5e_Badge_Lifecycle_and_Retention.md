# S5e: Video badge lifecycle and video deletion

Status: built and tested; awaiting push. The 90-day period is **provisional** until the advocate confirms it. Real property videos stay disabled until legal clearance (T2_ENABLED off).

## What changed for managers
- A video (T2) badge shows how long it is valid. It lasts 6 months, and never longer than the T1 document badge it depends on.
- **T2 counts only while T1 is valid.** If T1 expires or is withdrawn, the video badge is shown as *Paused*, and returns when T1 is verified again (if the video badge has not itself expired).
- **Renewal in the last 30 days.** The manager can record a new video while the old badge keeps counting, so there is no gap.
- **Moving the pin ends the video badge.** If the property pin moves more than 100 m from where it was when the video was approved, the T2 badge ends (reason: "The property pin was moved after the video check"). T1 stays. Small corrections under 100 m are fine. The event is audited without coordinates. A new video check can then be requested.
- Managers see whether a badge expired or was withdrawn and the reason, never who withdrew it.

## What changed for reviewers
- The *Verified* tab lists T1 and T2 badges with a marker, and shows T2 badges that are paused.
- Withdrawal of a T2 badge uses video reasons (for example "footage looks reused"), needs a reason, and "other" needs a note. It is logged with the reviewer, and flagged when a replay is suspected.
- Withdrawal does not change the original decision record.

## Video deletion job
- Runs once a day (Railway scheduler; also reachable through the protected cron endpoint).
- Deletes the stored video **90 days after the case is decided**, and recordings that were never submitted about 24 hours after their code expired.
- A video under an open appeal is never deleted.
- Order: the stored bytes are removed first, then the file is marked deleted. If removal fails it is retried in the next run.
- Kept: the case, the decision, the checklist, the two location readings and the video fingerprint.
- Each run that deletes anything writes one audit entry with counts only.

## Safeguards unchanged
Computed checks never approve or reject; a person decides. No continuous tracking (two readings per recording). Video access is restricted, logged and time-limited.

## Database
Migration `0015_t2_lifecycle.sql`; rules tests `db/tests/rules_s5e.sql` (20 checks).

## Open decisions for the advocate
1. Is 90 days right? 2. May the video fingerprint be kept longer? 3. When should a video be deleted if the manager never answers a "record again" request? 4. Retention end date for T1 documents.
