# S21: Public rental search (built, switched OFF)

Tenants can look for a rental without signing in. The feature is built and tested but **closed**: until you switch it on, every search address answers "not found" and the page says "Search is not open yet". Nothing changes for managers or for anyone using the system today.

## What a visitor sees
- `/homes`: filters (area, bedroom count, highest rent, documents-checked only, sort by newest or lowest total to move in), 20 results at a time, "Show more".
- Each result shows the property name, area, size, the rent, the **total to move in**, the date the manager last confirmed, and a "Documents checked" tag when the property has a valid badge.
- `/homes/<id>`: all five costs and the total, the confirmation date, the badge date with a link to "What does Verified mean?", and a note that contacting the manager comes in a later step (S22).
- English and Swahili. Works on a phone. No sign-in, no cookies set, nothing stored about the visitor by us.

## What is never shown
Organisation, exact address, map point, unit number, owner details, the manager's name or phone. Only the area is shown. A test checks the response for those words.

## What can appear
Only listings that are published, confirmed in the last 21 days, complete in all five costs, with the unit and property not archived. This is enforced by a database view (`supply.public_listings`, migration 0024) that the search reads exclusively, so even if the hiding job were late, nothing stale can appear, and a bug elsewhere cannot leak private columns.

## Protection of the service
- Per-address limit: 120 requests per 10 minutes by default (`PUBLIC_RATE_PER_10MIN`), then "too many requests". The visitor's address is passed on by the website (same shared secret as sign-in, `TRUSTED_PROXY_KEY`), so the limit applies to the visitor and not to our own server.
- Read-only. Only three web addresses can be reached (list, one listing, areas); anything else is refused by the website.

## The switch (do not turn on yet)
Set `PUBLIC_SEARCH_ENABLED=true` on the Railway API service. Remove it or set anything else to close search again immediately, no code change.
Before switching on, all of these must be true:
1. The lawyer has reviewed this page's wording, the privacy notice (visitors and tenants are now data subjects) and the terms (managers are responsible for the accuracy of what they enter).
2. The public home page (`/welcome`) and "What does Verified mean?" are updated: today they say tenant features are not ready.
3. Real listings exist from real managers (a search with nothing in it looks broken).
4. You have decided how visitors contact managers (S22), or accept that they cannot yet.

## Questions for the lawyer
- Visitors: the hosting providers log addresses of requests (Vercel and Railway). Is a line in the privacy notice enough, and where are those logs kept (regions)?
- May a listing show the property name and the "Documents checked" tag publicly? Is the wording "a record of that check, not a promise about the property" enough?
- Are the five costs and the total to move in, shown as entered by the manager, acceptable to display, with the manager responsible for accuracy?
- Do we need a way for the public to report a wrong or fake listing before launch (planned for S22)?

## Tests
Rule tests for the filters and the request limit. A full HTTP test of the switch (off, then on), what appears (live and fresh only: draft, 22-day-old and let listings are hidden), privacy of the response, the five costs and total, filters and sorting, the badge (valid, expired, revoked), detail and areas, archiving, the request limit (429) and that private routes still need sign-in. Website tests for the three allowed addresses. Full API suite 388 of 388 (with Redis), web 56 of 56, types clean, production build clean.

## Not in this slice
Contacting a manager and reporting a listing (S22), photos, map, saved searches, anything for buyers.

## Wording to review
New English and Swahili lines (keys starting `hm_`).
