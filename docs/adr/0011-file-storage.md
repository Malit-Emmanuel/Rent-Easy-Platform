# ADR-0011 File storage for property documents, photos and videos

Status: Accepted | Date: 2026-10-10 | Part of B3 slice S2

## Decision
- Files live in a **private** Supabase Storage bucket (`property-files`). The database table `supply.files` holds only metadata.
- Bytes never pass through our servers. The API checks permission and limits, then gives the browser a one-time signed upload link; the browser uploads straight to storage.
- After each upload the API reads the stored object's size and first bytes and **deletes the file** if either differs from what was declared (for example a program renamed `.pdf`).
- Opening a file uses a signed link valid for 5 minutes. Every link handed out is written to `governance.data_access_log`.
- Limits: documents 10 MB (PDF, JPEG, PNG), photos 8 MB (JPEG, PNG, WebP), videos 45 MB (MP4, MOV, WebM; under the 50 MB cap of the free storage plan). At most 10 documents, 20 photos and 3 videos per property or unit.
- Photos are shrunk in the browser before upload (largest side 1600 px) to save mobile data. This is a bandwidth saving, not a security control.
- The storage secret key is used only by the API on Railway. It carries the same trust level as the database owner password the API already holds.
- If storage is not configured the file features switch off (HTTP 503); they never fall back to something less safe.

## Known gaps and open items
- **No virus or malware scanning yet.** Type and size are checked and files are only ever opened by authorised people through short links, but content is not scanned. Revisit before the pilot.
- **Retention.** Deleting a file hides it but keeps the stored object until a retention rule is agreed with counsel.
- **Real documents.** Ownership documents can contain personal data (including ID numbers). The project is in Ireland (eu-west-1). Use test files only until counsel confirms handling and cross-border transfer (ADR-0002).
- The list of acceptable ownership documents is a placeholder (decision 5) and is changed with a data update.
- Abandoned uploads (links issued but never completed) stop counting after 3 hours; a scheduled cleanup comes with slice S6.
- The Supabase adapter follows Supabase's documented API and is tested against a local imitation. A real upload to Supabase is verified after deployment.
