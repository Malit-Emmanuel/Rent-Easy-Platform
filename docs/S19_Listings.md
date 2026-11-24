# S19: Listings for managers

Managers can now put a unit on offer, keep it up to date, and take it off. Tenants cannot see listings yet: public search is a later slice (S21) and waits for the lawyer.

## What a manager can do (property page, "Listing" on a unit; and a Listings page per organisation)
- **Start** a listing for a unit (a draft). A unit has at most one open listing (draft, published or needing confirmation) at a time.
- **Enter the five costs** in whole Kenya shillings: monthly rent, deposit, utility deposit, service charge, agent fee. Zero is allowed for everything except rent. The screen shows the **total to move in**.
- **Publish**, only when all five costs exist. The API says which are missing, and the database refuses too (existing rule, so it cannot be bypassed).
- **Confirm it is still available.** A published listing carries "last confirmed", a reminder date (14 days) and a hide date (21 days). The reminder and hiding are done by a job in the next slice (S20); this slice only records and shows the dates and lets a "stale" listing be confirmed again.
- **Change a cost** on a live listing: this counts as confirming it.
- **Mark as let** or **Withdraw**: both are final for that listing. The unit can be listed again with a new listing.
- Archiving a unit or a property withdraws its open listings, so nothing stays on offer for something hidden.

## Who can do it
Same people as for properties: administrators, staff, landlords and agents of that organisation. Everything is locked to the organisation in the URL; another organisation gets "not found" for a guessed id.

## Interface (API)
`GET orgs/:orgId/listings?status=&propertyId=&limit=`, `GET orgs/:orgId/listings/:id`, `POST orgs/:orgId/properties/:pid/units/:uid/listings` (costs optional), `PUT orgs/:orgId/listings/:id/costs`, `POST .../publish`, `.../confirm`, `.../let`, `.../withdraw`. Amounts are shillings in and out; stored as cents (minor units).

## Database (migration 0023)
- One open listing per unit (partial unique index).
- A published or stale listing must have its published and confirmed dates.
- Costs can only be in KES.

## Audit
`listing.created`, `listing.costs_set`, `listing.published`, `listing.confirmed`, `listing.let`, `listing.withdrawn` are written to the hash-chained trail with the organisation (and the total move-in where relevant).

## Tests
API: 17 new HTTP checks (permissions, validation, five-cost rule including the database guard, one open listing per unit, confirm, edit-as-confirm, let/withdraw finality, organisation isolation, archive withdraws, audit chain) and 4 pure rule tests. Full API suite 371 passed, 1 skipped (as before), 0 failed, against a fresh database with migrations 0001 to 0023. Web: 53 of 53; types clean; production build clean.

## Wording to review
New English and Swahili lines (keys starting `ls_`) are in the Swahili review sheet list for the next review round. The Listings page says plainly that tenants cannot see listings yet.

## Not in this slice
Hiding stale listings and reminders (S20), anything tenants see (S21), contact and reports (S22), photos on listings, buyer or sale listings.
