# ADR-0013: Review cases and the T1 badge (S4)

Status: accepted (founder sign-off 29 Oct 2026). Details: S4 Design Note.

## Decisions
- Every T1 decision is made by a person. No automatic or AI approval.
- **No self-review:** a reviewer who is a member of the case's organisation cannot claim or decide the case. Enforced in the API and again by a database trigger.
- **Appeals:** one per rejected case, within 14 days, decided by a different reviewer. An appeal cannot be appealed.
- **Deadline:** 2 working days (Monday to Friday; public holidays ignored in v1). The clock pauses while a case waits for changes.
- **Reason codes** are mandatory for rejection, needs-changes and revocation. `other` needs a written note.
- **Evidence is frozen** while a case is open or approved: its documents cannot be deleted or replaced.
- **Badges** last 12 months (T1), must expire after they are issued, and never count once expired or revoked. Expiry is computed from dates, not by a background job.
- Managers see the reason code and note, never the reviewer's identity.
- **Required proof documents are a placeholder** until the advocate confirms them (open launch gate).
- Test files only until counsel confirms handling of real documents.

## Database (migration 0010)
`verification.cases`, `verification.case_files`, new property reason codes, guard triggers (reviewer role, same-organisation block, appeal rules, final decisions, frozen evidence), and `badges_expiry_after_issue`. Row security on, no policies, as everywhere else.

## Open
A second real reviewer is needed before launch, because founders who belong to an organisation cannot review its cases.
