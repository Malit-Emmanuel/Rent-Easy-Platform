# S8: "My data" (access, correction and deletion requests)

## Why
The data protection pack lists "subject rights" as not built: people must be able to see what we hold about them and ask us to correct or delete it (Data Protection Act, 2019, as we understand it; counsel to confirm). Deleting is the sensitive part here: evidence in open verification cases, the tamper-proof audit record and retention periods are all still open questions for the lawyer. So this slice **shows and records, and never deletes**.

## What changed
| For | What |
|---|---|
| Every signed-in person | **My data** page. Download everything held about you as one file. File a correction or a deletion request. See the status and our written answer. |
| Administrators (`super_admin`) | **Oversight > Privacy requests**. See open requests with the requester's name and number (to confirm who is asking), then mark each Done or Declined with a written note. |

### The download
Contains: profile, roles, organisations you belong to, your uploads (file details, not the files), your verification cases, identity-check results, consents, video-check readings you made (including the two location readings and the computed notes), your review work (reviewers), your activity (last 500 actions), and your requests.
Leaves out, and says so in the file: sign-in codes and session tokens (only one-way hashes), sign-in address checks (hashed, deleted after a day), the identity of reviewers who decided your cases, other people's information inside your organisations, the files themselves, and internal quality checks about reviewers (under legal review).
Limited to 5 downloads an hour. Each download is written to the audit trail as "a download happened", with no contents.

### Requests
- Two kinds: correction (must say what is wrong, 5 to 1000 characters) and deletion (details optional).
- One open request of each kind per person.
- **Filing a request changes nothing.** The account, files and sign-in stay as they were.
- An administrator closes a request as Done or Declined with a written note (5 to 1000 characters). Done means a person has actually made the change by hand.
- Rules held by the database itself: only an open request can be closed; only a `super_admin` can close it; an administrator cannot close a request about themselves; the request and its details cannot be edited afterwards; requests cannot be deleted.
- Every administrator view is written to the data access log. The audit trail records filing and handling with the kind and the outcome only, never the details.

## What is deliberately not built
- **Automatic deletion.** Waits for counsel on: open cases and appeals, the audit record (it holds identifiers; anonymising the account would leave the hashed chain intact), retention periods, and whether a requester must prove their identity beyond signing in.
- **A reply by message** when a request is closed. Needs the live message accounts.
- **A response deadline counter.** Counsel to confirm the legal deadline; the dashboard then shows requests approaching it.

## Questions added for the lawyer
1. Is the download complete and suitable as the answer to an access request? Should it include the files, and should it include the internal quality checks about a reviewer?
2. How long do we have to answer correction and deletion requests, and how should identity be confirmed?
3. When a person asks for deletion while a case is open or under appeal, or when evidence is held, what do we keep, for how long, and what do we tell them?
4. Is anonymising the account (removing phone and name but keeping the internal ID in the audit trail) acceptable for deletion?
5. Can a suspended person download their data? (Today a suspended account cannot sign in, so it cannot.)

## Tests
8 subtests over HTTP: the download holds her data and nothing from other people (phone, name, case and reviewer identity checked), leaves out secrets, and is rate limited; request validation and one open request per kind; a request changes nothing; administrator-only access with every view logged; handling rules, the written note and the requester seeing the answer; the database guard (own request, edits after closing, non-administrator, deletion). Dashboard: proxy routes (1 test).
