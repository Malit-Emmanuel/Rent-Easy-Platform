# ADR-0012 Bulk import of units from a spreadsheet

Status: Accepted | Date: 2026-10-14 | Part of B3 slice S3

## Decision
- Managers upload a **CSV** (one row per unit) on an Import page. A **dry run** reads and checks the file and compares it with what already exists; **nothing is saved** until the person confirms.
- The dry run stores the checked plan on the server (`supply.import_runs`). **Confirming applies that stored plan**, never data sent by the browser. A plan older than 24 hours cannot be confirmed.
- Confirming is all-or-nothing and uses a few bulk statements in one transaction, so even 2,000 rows are quick and a failure leaves nothing behind.
- A file with any **error** can never be confirmed (enforced in code and by a database rule). Warnings (for example an unknown area, or a unit that already exists and is skipped) do not block.
- The same building across rows (ignoring letter case and extra spaces) becomes one property; an existing property is reused, an existing unit label is skipped.
- Column names are matched loosely (building, estate, unit no, beds, lat, long, and more); bedroom wording such as "2 BR", "Two bedroom", "bedsitter" or "studio" is understood.
- Limits: 2 MB and 2,000 rows per file; 30 previews per organisation per hour. Every created property and unit carries the id of its import run, and previews and confirmations are in the audit trail.
- Everything is scoped to the organisation in the URL; any member who may create properties may import.

## Known limits and open items
- **CSV only.** Excel (.xlsx) files must be saved as CSV (UTF-8) first. Direct Excel support can be added if managers need it.
- The matching rules were tuned on synthetic and template data. The one real sample received (a scraped sales-listing file) had none of the needed columns, so a real manager's rental sheet is still needed to tune it.
- If an import fails and is retried, the earlier preview stays usable until it expires.
- Data typed into a spreadsheet is stored as text. Any future export to spreadsheets must neutralise cells that start with `=`, `+`, `-` or `@` to prevent formula injection.
