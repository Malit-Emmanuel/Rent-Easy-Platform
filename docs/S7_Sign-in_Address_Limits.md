# S7: Per-address limits on sign-in

## Why
Sign-in already limited each phone number (3 codes in 10 minutes, a pause between codes, 5 wrong guesses per code, and a daily cap on paid messages). Nothing limited one internet address. That left two gaps:
1. **Message spraying.** One address could ask for codes for thousands of different numbers. Each code is a paid SMS or WhatsApp message, and it annoys the people who receive them.
2. **Guessing across numbers.** One address could try a few guesses against many numbers, staying under every per-number limit.

## What changed
| Limit (per visitor address) | Default | Setting |
|---|---|---|
| Code requests in 10 minutes | 20 | `AUTH_IP_OTP_PER_10MIN` |
| Different phone numbers asked for in one hour | 10 | `AUTH_IP_PHONES_PER_HOUR` |
| Refused sign-in attempts in 10 minutes | 30 | `AUTH_IP_VERIFY_FAILS_PER_10MIN` |

Going over gives a plain "Too many requests. Try again later." (HTTP 429). A suspended-account message does not count as a guess. Invalid phone numbers do not use up the request allowance.

## Privacy
- The address is never stored. Only a keyed hash (HMAC with the server's secret) is kept, in `identity.auth_ip_events`, together with a keyed hash of the phone number for the "different numbers" count.
- Rows are deleted after one day by the existing `purge-auth-data` job.
- The table is write-and-read by the API only (RLS on, no public access).
- IPv6 addresses are counted by their /64 block, because a person can switch freely inside it.
- Counting addresses is a security measure, not tracking of people. It is a point for the lawyer to note in the privacy notice (the address is personal data even when hashed); it is listed in the questions for the advocate.

## Which address is counted
The dashboard (on Vercel) calls the API, so the API would otherwise see the dashboard's address for every visitor. The dashboard now forwards the visitor's address with a shared secret. The API believes it only when the secret matches. Without the secret, the API counts the last `X-Forwarded-For` entry (the one our own host adds; entries earlier in the list are written by the caller and are ignored), then the direct connection.

**One-time setup you must do before launch:** set the same random value of at least 32 characters as `TRUSTED_PROXY_KEY` on Railway (API) and Vercel (dashboard). Until then every dashboard visitor shares one address, so the defaults would pinch real users once there are many. For the test stage with a handful of users this does not matter.

## Tests
- Address helper: normalisation, secret check, last-entry rule (3 tests).
- Over HTTP (6 subtests): spraying across numbers is stopped and no code is made; the 10-minute allowance holds; failed guesses across numbers pause the address while other addresses sign in normally; a forged header cannot dodge the limit; only hashes are stored and the purge removes old rows; invalid numbers do not use the allowance.
- Dashboard: header forwarding rules (2 tests). Configuration rules (1 test).

## Not done
- Delivery reports from the message providers (needs the live accounts).
- Blocking by country or by known bad networks (not needed at this scale).
