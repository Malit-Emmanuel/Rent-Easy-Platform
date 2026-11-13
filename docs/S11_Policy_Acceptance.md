# S11: Recording acceptance of the privacy notice and terms

Structure only. No wording is decided here, and nothing is required of anyone yet.

## How it works
- Table `governance.policy_acceptances` (migration 0020): who accepted which document (privacy or terms), which version, in which language, when. Append-only (no edits, no deletes). One record per person, document and version.
- The operator puts a version in force by setting `POLICY_PRIVACY_VERSION` and `POLICY_TERMS_VERSION` on Railway (for example `2026-12-a`), only after the lawyer has approved the text. Unset means: nothing is listed, nothing is required, nothing can be accepted.
- `GET /me/policies` lists documents in force and whether the person accepted each. `POST /me/policies/accept` records acceptance of the current version only; an old or unknown version is refused (409), so the record can never claim text that was not in force. Accepting twice changes nothing.
- Each new acceptance is written to the audit trail (`policy.accepted`, document and version only).
- The person's own data export now includes their acceptances.
- Web: a banner with links to both documents and one button, shown only while something in force is unaccepted. It does not block the app. Whether it should block is a legal decision for the lawyer.
- When the text changes, change the version: everyone is asked again, and old records stay.

## Before turning it on (your steps, later)
1. Lawyer approves both texts and the Swahili is reviewed.
2. Fill the company details and set `NEXT_PUBLIC_LEGAL_PUBLISHED=true` on Vercel.
3. Set the two version variables on Railway.

## Checks
New API test (9 checks): nothing required until set; one at a time; others unaffected; twice is harmless; wrong version, document or language refused; new version needs new acceptance; record cannot be edited or deleted and shows in the export; sign-in never blocked. Full API suite 350 of 350. Web tests 48 of 48 and the build passes.

## Not done
Whether acceptance should block use, and any separate consent for video and location (that stays in the video flow). Swahili of the three banner lines needs review.
