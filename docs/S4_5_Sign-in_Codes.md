# S4.5 Sign-in codes: WhatsApp first, SMS second

## What was built
- One delivery layer for sign-in codes with three channels: WhatsApp, SMS and a test-only log channel.
- Africa's Talking SMS adapter and Meta WhatsApp Cloud API adapter. Both were tested against local mock servers built from the published API formats. **Neither has run against a real account yet.**
- Order: WhatsApp, then SMS (when WhatsApp is configured). If a channel refuses the message, the next one is used at once. Every attempt is recorded in `identity.otp_deliveries` (channel, accepted or failed, provider message id, short error code). No phone number and no code are stored there.
- "Send by SMS instead": the sign-in page offers it after the resend wait when the code went by WhatsApp. WhatsApp often reports "not on WhatsApp" later, not at send time, so this button is the real safety net.
- Daily cap (`OTP_DAILY_CAP`, default 2000) on paid messages. At the cap, codes stop, the event is audited and logged, and people see "cannot be sent right now".
- Test allow-list (`DEV_OTP_ALLOWLIST`, up to 5 numbers): the code goes to the server log only. The response looks the same as for any other number.
- Production rule: `APP_ENV=production` now starts only with a real channel configured or a non-empty allow-list. Africa's Talking sandbox is refused in production. Fake adapters refuse to run in production.
- A code that could not be sent is closed so it cannot be used.

## Not built yet (on purpose)
- Provider delivery reports (webhooks). Their exact formats and signing need to be checked against a real sandbox account first.
- Per-IP limits. The API sees the dashboard server's address, not the visitor's, so a per-IP limit here would block everyone. The per-number limit (3 per 10 minutes, 30 seconds apart) and the daily cap protect spending for now.
- Invitation messages still use plain SMS and need a real SMS provider in production.

## Your side (needed before real users)
1. Register the company.
2. Pick the sender name (up to 11 characters, matching the company name, e.g. EDUPATO).
3. Open an Africa's Talking account; ask about the transactional sender-ID fee and turnaround, and whether they offer WhatsApp.
4. Create a Meta Business account and complete business verification (needs the company documents).
5. Get a phone number for WhatsApp that is not on a personal WhatsApp account.
6. Create and submit the WhatsApp authentication template named `edupato_login_code` (language en) for approval.
7. Send me the sandbox keys (never in chat: set them as Railway variables yourself) and I will test against the sandbox.
8. At launch: set `AT_ENV=live`, the live keys, `AT_SENDER_ID`, `NEXT_PUBLIC_HIDE_DEV_NOTICE=true` on Vercel, and remove test numbers from `DEV_OTP_ALLOWLIST`.

## Warning about the allow-list
Anyone who can read the Railway log can sign in as an allow-listed number. Use it for demo and test accounts only. A real reviewer (the number ending 477) should receive real codes once the provider is live, because reviewers can approve badges.
