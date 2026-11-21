# S14: Rebrand from Zuri Home to Edupato Homes

The name Zuri Home had been registered by another entity, so the product is now **Edupato Homes**, using the logo of Edupato Enterprise Limited.

## What changed in the app
- **Name** everywhere people can read it: menus, top bars, sign-in, home page, "What does Verified mean?", privacy notice, terms, My data (including the downloaded file name, now `edupato-homes-my-data-<date>.json`), page titles, the home-screen app name.
- **Emblem**: traced from the supplied logo into a sharp, scalable image (ring and "E"), white ring on dark backgrounds. Browser tab icon, phone home-screen icons and the Apple icon are regenerated from it. The wordmark is shown as EDUPATO in the logo red with HOMES spaced out beneath, echoing the company logo's own lock-up. The full original logo file was not placed in the app, because it is a picture: send the vector or high-resolution file if one exists.
- **Colours** now come from the logo: red `#c8141b` for actions (the exact logo red `#ed1c24` for the emblem), black `#0b0d0c` for the menu and header, a warm white background. Green remains only for "verified / OK" so success still reads as success.
- **Type**: bold sans-serif headings to match the logo lettering.
- **Messages**: the sign-in text now reads "Your Edupato Homes code is ... It expires in 5 minutes. Do not share it."
- **Sender name** default changed from ZURIHOME to EDUPATO (1 to 11 letters; register it with Africa's Talking only after the name is cleared).
- **WhatsApp template** default changed from `zuri_login_code` to `edupato_login_code` (submit that template to Meta under the new business name).

## Deliberately NOT changed (internal names, never shown to people)
`x-zuri-client-ip` and `x-zuri-proxy-key` (the private link between the website and the API) and `zuri.actor_id` (the database setting used when granting roles). Renaming them would need both servers and the database changed at the same moment for no visible benefit. They can be renamed later in a planned change.

## Outside the code (your side)
1. **Domain**: zurihome.app still points at the app. Choose and buy the new domain (for example one containing "edupato"), and I will connect it in Vercel and keep the old one redirecting.
2. **Trademark**: have the lawyer check "Edupato Homes" for conflicts before spending on the sender name, Meta verification or ID provider contracts.
3. **Company name**: the logo reads "Edupato Enterprise Limited". Please confirm the exact registered name, number, address and signer; the privacy notice and terms still show "to be confirmed" until then.
4. **Partner accounts** not yet opened (Africa's Talking, Meta, ID provider) should be opened under the new name only.
5. Old Word documents and review sheets still show the old name in places; the open items document has been regenerated.

## Checks
API suite 350 of 350. Web tests 51 of 51 and the build passes. Checked on desktop and phone: sign-in, home, properties, property page, review queue, My data, privacy notice, public home page.
