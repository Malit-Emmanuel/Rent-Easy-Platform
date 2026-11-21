# S13: Brand mark, public home page, "What does Verified mean?", installable web app

Web only. No change to the API, the database, sign-in or any data.

## What changed
- **Logo**: a house with a check inside it (a property that has been checked), deep green with a gold check. Used in the side menu, top bars, sign-in, the browser tab icon, and the phone home-screen icons. It is a working mark, not a final brand: replace `src/app/icon.svg`, `src/components/Logo.tsx` and the PNGs in `public/icons` and `src/app/apple-icon.png` when the company has a real logo.
- **Public home page** (`/welcome`): visitors who are not signed in and open zurihome.app are sent here instead of the sign-in page. Signed-in people still land on their dashboard. It explains how it works, who it is for, and our promises. It says plainly that tenant and buyer features are not ready yet, and shows "being tested, not open to the public yet" until `NEXT_PUBLIC_LEGAL_PUBLISHED=true`.
- **"What does Verified mean?"** (`/verified`): what we check, what a badge means, what it does not mean (not a guarantee of ownership, price or condition), and what happens if something is wrong. States that the video check is switched off today.
- **Public frame**: these two pages and the privacy notice and terms now share one header (logo, language, Sign in) and footer (links).
- **Installable web app**: a manifest and icons let people add Edupato Homes to the phone home screen. Nothing is stored for offline use.
- **Contrast fixes**: two small texts were slightly below the accessible contrast and were darkened. All other main colour pairs pass 4.5 to 1.

## Rules built into the text
A test fails if the public pages contain figures, promised times, "guarantee", "testimonial", "trusted by" or similar claims, or if they stop saying that video is switched off and tenant/buyer features are not ready. Marketing claims need the lawyer's eye before the pages are opened to the public.

## Still not indexed by search engines
The site keeps `noindex` until you decide to launch.

## Not done
Final logo and brand colours. First-use walkthrough, friendlier empty states and loading placeholders. Rewording the sign-in text and WhatsApp messages. Swahili of the new pages needs review (sheet 4).
