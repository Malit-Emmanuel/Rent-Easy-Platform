# S15: First-use polish

Web only. No change to the API, the database, sign-in rules or any data.

## What changed
- **Getting started card** on the home page: four plain steps (create your organisation, add properties and units, verify who you are, send your property documents). Steps 1 to 3 tick themselves from real data; step 4 points to the first property. It can be hidden (remembered in the browser only, never stored on the server) and shown again with a link. It disappears for good once steps 1 to 3 are done and it is hidden. It replaces the older single "Next step" card.
- **Loading placeholders**: grey shimmering bars instead of the word "Loading…" on every page that loads data (home, organisation, properties, property, verification, reviews, oversight, My data). Screen readers still hear "Loading…". The shimmer stops for people who ask their device for reduced motion.
- **Friendlier empty screens**: a new home screen for someone with no organisation yet ("Welcome to Edupato Homes", with what to do next) and an explained empty properties list.
- **Sign-in wording**: every sign-in message now says what to do next ("That number does not look right. Use a Kenyan mobile number such as 0712 345 678", "That code did not work. Check the 6 digits, or go back and ask for a new code"). The code messages say the code works for 5 minutes and must not be shared. A one-line hint under the phone box says no password is needed.

## Swahili
All new and changed lines exist in both languages and a test checks that both languages have every key. The Swahili is a draft: it goes on review sheet 5.

## Checks
Web tests 53 of 53, type check clean, build passes. Viewed on desktop and phone with the API mocked: new user, user with an organisation, empty properties, loading state, sign-in error.

## Not done
Walkthrough steps do not yet know when property documents have been sent (the home page does not load case data); step 4 is therefore a pointer, not a tick. A guided tour overlay was left out on purpose: it hides the screen and is hard to use on a phone.
