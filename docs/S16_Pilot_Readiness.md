# S16: Pilot readiness (database indexes, backups, alerts, "if something breaks")

Checked live on 24 November 2026. Nothing in this step changes how the app behaves.

## What the live checks found
- API (Railway): 0 server errors in 72 hours (73 requests). Website (Vercel): no runtime errors in 72 hours.
- Database security advisor: only "RLS enabled, no policies" on 40 tables. This is intentional: the API is the only route in and the public roles have no access.
- Database performance advisor: 35 foreign keys without an index, 11 indexes never used. Harmless at today's size. Migration `0022_foreign_key_indexes.sql` adds the 35 missing indexes. The 11 unused ones are left alone: they will be used once real data arrives.
- Audit trail: 89 events on the live database (verify the chain after the push, see below).

## Before real users: what to switch on (your side)
| # | What | Why | Who |
|---|---|---|---|
| 1 | Paid Supabase plan with daily backups, in an organisation owned by the company | The free plan can pause when idle and has limited backups. Check the plan's current backup terms on Supabase's pricing page | You |
| 2 | Free uptime monitor on two addresses: the API `/health` and the website `/welcome`. Alert by email and SMS to two people | You should hear about an outage before users do. Any common uptime service will do | You (I can list what to enter) |
| 3 | Paid Vercel plan in the company's name | The free plan is for non-commercial use | You |
| 4 | A production environment on Railway (today there is only "staging") | Keeps tests and real data apart | You and me |
| 5 | Two people with admin access on every account (GitHub, Vercel, Railway, Supabase, domain) | One lost phone must not lock the company out | You |

## Backup and restore routine
1. Backups: rely on Supabase's daily backups once on a paid plan. Also keep a monthly dump you hold yourself (Supabase dashboard, Database, Backups, or `pg_dump` over the direct connection), stored encrypted in the company's drive, not on a laptop.
2. Files (documents and videos) live in Supabase Storage. They are not part of a database dump. Ask Supabase how storage is backed up on the plan you buy, and write the answer here.
3. Restore drill, once before launch and then every quarter: restore the latest backup into a new, empty Supabase project, point a test copy of the API at it, sign in, open a case, and run `select count(*) from governance.audit_events` to compare with live. Delete the test project afterwards. A backup that has never been restored is not a backup.
4. Audit chain check, after any restore and once a month: run the same read-only check used in the acceptance reports (every link joins to the one before and every hash recomputes). Expect 0 broken links and 0 wrong hashes. Ask me to run it; a permanent built-in check is a good later addition.

## If something breaks
| Situation | First steps |
|---|---|
| Website down or showing errors | Vercel dashboard, Deployments. If the latest one is the cause, promote the previous good deployment ("Instant Rollback"). Then tell me; I will read the logs |
| API down or failing | Railway, the api service, Deployments. Roll back to the last SUCCESS deployment. Check the `/health` address. Do not change variables in a hurry |
| Sign-in codes not arriving | Check the provider dashboards (Africa's Talking, Meta). The sign-in page offers SMS after 30 seconds when WhatsApp is used. The daily cap may have been reached: the audit trail records it |
| A key or password may have leaked | Rotate it at once: `JWT_SECRET` and `OTP_PEPPER` on Railway (this signs everyone out), provider keys at the provider, the database password in Supabase. Never paste keys in chat or email |
| Personal data may have been exposed | Write down what, when, and who. Turn off `T2_ENABLED` if video is involved. Tell the lawyer the same day. The notice to the Data Commissioner is believed to be due within 72 hours of becoming aware; the lawyer confirms the exact duty and wording |
| A reviewer misuses a case | Remove the reviewer role (the grant and removal are recorded in the audit trail), tell the lawyer, and check the data access log for what was opened |
| Wrong badge given | A reviewer can withdraw a badge with a reason (logged with the reviewer, and flagged if a replay is suspected). The owner sees the reason, never who withdrew it. Withdrawal does not change the original decision record |

## Contacts to fill in before launch
Hosting account owners and their backups; lawyer; Africa's Talking and Meta support lines; the person who answers the uptime alerts. Keep this list outside the repository.

## Applying the migration
After the patch is pushed and CI is green: apply `0022` to Supabase (`apply_migration`), then run the performance advisor again and expect no "unindexed foreign keys" notices. Run the audit chain check.
