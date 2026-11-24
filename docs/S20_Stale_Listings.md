# S20: Reminders and hiding of stale listings

A listing that nobody has confirmed for a while stops being offered, so tenants are never shown a home that was let weeks ago. Tenants still cannot see listings (search is S21); this slice makes sure the rule is already working when they can.

## The rule
- **Day 0:** a listing is published or confirmed (changing a cost counts as confirming).
- **Day 14:** the manager sees "Confirm soon" on the property page and the Listings page, with a notice asking them to confirm.
- **Day 21:** a job takes the listing off offer (status "stale"). Nothing is deleted. The manager presses "Confirm it is still available" and it is offered again.
- Drafts, let and withdrawn listings are never touched by the job.

## How it runs
- Job `hide-stale-listings` runs every hour on the existing background-job system (also reachable at `/internal/cron/hide-stale-listings` for serverless hosting, daily there).
- Each hidden listing is written to the hash-chained audit trail as `listing.hidden_stale` with no person as actor (a system action), showing the last confirmation date and the 21 days.
- The API now returns `phase` for a published listing: `ok` or `remind`.

## Not in this slice
- **Messages** (WhatsApp/SMS) to remind managers: they wait for the approved sender accounts. For now the reminder is on screen only. When the providers are live, the same 14-day rule can send one message per listing.
- The 14 and 21 days are constants in `listings.rules.ts` (tunable by a code change).

## Tests
Rule tests for day 13, 14, 20 and 21; an HTTP test that a 3-day, 15-day, 22-day and 40-day (let) listing are treated correctly, that a second run changes nothing, that the audit entry has no actor, and that confirming brings a hidden listing back; the scheduler test lists the new job. Full API suite 374 of 374 (with Redis), web 55 of 55, types clean, production build clean.

## Wording to review
Four new English and Swahili lines (keys `ls_stRemind`, `ls_remindNote`, `ls_staleNote`, `ls_needAttention`).
