# S5b: T2 challenge and submission API

Status: built and tested. Real property videos stay switched off (`T2_ENABLED` is false unless set on purpose).

## Flow (manager)
1. `GET   .../verification/t2` status: blockers, active challenge (code and units only for the person who got it), case, limits.
2. `POST  .../verification/t2/challenge` body `{consent:true}`: 4-digit code, 1 unit (2 above 10 units), 30 minutes, 3 takes.
3. `POST  .../t2/challenge/:id/take` body `{mimeType,sizeBytes}`: starts a recording; earlier unsubmitted takes are discarded. Browser uploads, then calls the usual `files/:fileId/complete`.
4. `POST  .../t2/submit` body `{challengeId,fileId,start:{lat,lon,accuracyM,at},end:{...}}`: creates the T2 case (3 working days) or sends a "needs changes" case back with a new attempt.
5. `POST  .../t2/appeal`: one appeal of a rejected T2 case; reads the original evidence.

## Rules worth knowing
- Fingerprint (SHA-256) is computed by the server from the stored file, never taken from the browser.
- Hints (distance bands, readings disagree, reading equals pin, reused video, copied position, late upload) are stored for the reviewer, shown only to reviewers (S5d) and never decide anything. Managers do not see them.
- Audit events carry no code and no coordinates.
- Migration 0014 ties every video to its challenge (`verification.t2_takes`) and the database refuses evidence for any other video.
- T1 screens and reviewers ignore T2 cases until S5d.
