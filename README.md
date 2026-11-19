# Kenya Housing Connection Platform

Trusted transaction infrastructure for housing in Kenya. Spine: Discover, Verify, View, Apply, Sign, Pay, Record.
Source of truth: *Development Execution Plan v1.0* (28 Sep 2026). Scope guard: `docs/NOT_IN_V1.md`.

## Status (November 2026): running on staging, test data only
The API runs on Railway, the database on Supabase and the dashboard on Vercel. Slices S1 to S13 are built, tested and deployed. No real tenant data, ID checks or property videos are processed yet (see "Before real data" below).

| Slice | What it delivers | Notes |
|---|---|---|
| Foundations | Postgres + PostGIS schema, migration runner, config validation, event bus, consent logic, RBAC guard, hash-chained audit log, double-entry ledger, provider ports, money helpers | ADRs 0001 to 0010 |
| Sign-in and organisations | Phone sign-in codes, rotating sessions, organisations, staff invitations, profile, vendor-neutral ID-verification layer, BullMQ background jobs | |
| S1 to S3 | Properties and units, file storage, bulk CSV import (apartment-first unit names, optional floors) | ADRs 0011, 0012 |
| S4 | Property verification requests, reviewer queue and claims, case page, decisions, revoke and renewal, T1 badge | [Acceptance report](docs/S4_Acceptance_Report.md) |
| S4.5 | Sign-in codes by WhatsApp first, SMS fallback, with per-number limits and a daily cap on paid messages | [Note](docs/S4_5_Sign-in_Codes.md) |
| S5 | T2 badge: video and location verification, reviewer evidence panel, badge lifecycle and video retention | Built but switched off (`T2_ENABLED`). [Acceptance report](docs/S5f_Acceptance_Report.md) |
| S6 | Reviewer integrity: review time record, integrity rules engine with daily scan and alerts, stale-claim release, cost and reviewer reports, oversight screens | [Acceptance report](docs/S6f_Acceptance_Report.md) |
| S7 | Per-internet-address limits on sign-in | [Note](docs/S7_Sign-in_Address_Limits.md) |
| S8 | "My data": access, correction and deletion requests (recorded, never auto-deleted) | [Note](docs/S8_My_Data.md) |
| S9 to S11 | Draft privacy notice and terms (English and Swahili), audited platform-role grants, policy acceptance recording | |
| S12 to S13 | Visual refresh, brand mark, public home page, installable web app | |

Tests: 20 database migrations with SQL rule tests (`db/tests`), plus about 180 automated API and web tests across 62 test files. CI runs on every push (`.github/workflows/ci.yml`).

### Before real data
Per [ADR-0005](docs/adr/0005-legal-gate.md), no payment, ID-check, data-processing or property agreement is signed until the company is registered and an advocate has reviewed the [data protection pack](docs/Advocate_Pack_Data_Protection.md). Real property videos stay off (`T2_ENABLED=false`) until legal clearance. Scope guard: [`docs/NOT_IN_V1.md`](docs/NOT_IN_V1.md).

## Run
    docker compose up -d          # starts Postgres+PostGIS and Redis
    cd apps/api && cp ../../.env.example .env && npm install && npm run migrate
    npm test && npm run build && npm run dev     # GET :3000/health

## Design rules enforced in code
- Money = integer minor units (bigint), never floats.
- Audit log and ledger are append-only (DB triggers); audit rows are hash-chained.
- Ledger is double-entry and must balance per transaction at commit.
- A listing cannot be published without all five cost rows (zero allowed).
- Badges carry expiry; revocation needs a reason code.
- Every vendor sits behind a port in `apps/api/src/providers`.


## Jobs
Background jobs run on BullMQ when `REDIS_URL` is set (verification-session expiry every 10 min, auth-data purge daily). If Redis is missing or unreachable the API still starts and jobs are disabled with a logged warning.

## Deploying the API as a container on Railway (ADR-0010; full steps in docs/deploy-railway.md)
1. Build: `docker build -t khp-api apps/api` (the image installs production dependencies only and runs as a non-root user).
2. Run with the environment variables from `.env.example`: DATABASE_URL (Supabase connection string with `?sslmode=require`; pooled if the host is IPv4-only), REDIS_URL, JWT_SECRET, OTP_PEPPER, CORS_ORIGINS, APP_ENV=staging.
3. Apply migrations separately (Supabase `apply_migration` or `npm run migrate` against a direct connection); the image does not contain them.
4. Check `GET /health`. The container's health check calls it.
5. The dashboard (`apps/web`) deploys to Vercel with `API_URL` pointing at the container.

## Database: Supabase (ADR-0010)
Apply `db/migrations/*.sql` in order (the Supabase `apply_migration` tool or `npm run migrate` on a direct connection).
Check any database with `db/tests/rules_portable.sql`: it rolls back and reports `RULES: N passed, M failed` in its final error message.
The API connects as the database owner with its own authorisation; RLS is enabled with no policies as a second layer.

## Dashboard (apps/web, Next.js, deploys to Vercel)
`cd apps/web && cp .env.example .env.local && npm install && npm run dev` (needs the API running; set `API_URL`, and `COOKIE_SECURE=false` for local http).
Sign-in with phone OTP, home, organisations (members, invitations), ID-verification status, reviewer queue. English and Swahili.
The browser never sees tokens: server routes keep them in httpOnly cookies and forward only allow-listed paths to the API.
