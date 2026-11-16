# S12: Visual refresh

Look and feel only. No change to behaviour, data, sign-in or the API.

## What changed
- Palette: deep forest green (trust) with warm sand backgrounds, terracotta and gold used sparingly. "Zuri" means beautiful in Swahili. All colours are tokens at the top of `globals.css`; change them there to re-theme everything.
- Type: warm serif for headings and numbers (system fonts, no downloads, so no new third-party calls), clean sans for text. Small labels no longer use monospace.
- Side menu: deep green with a gold marker on the current page, a "Z" logo mark. On phones: a matching top bar and a bottom bar whose six items fit a 390px screen.
- Cards, tiles and tables: softer shadows, rounder corners, coloured tile tops, hover lift on property cards, richer gradient pictures.
- Forms: taller inputs and buttons (46px, easier to tap), clear green focus ring, pressed and hover states. Motion respects "reduce motion".
- Sign-in: a card with the logo above it, and a large spaced-out box for the six-digit code.
- Privacy and terms: each section is a card; the draft banner is clearer. Fixed: the draft banner followed the phone's dark mode although the app is always light.
- Dark palette is updated to match and stays off until a switch is added.

## Checks
Web tests 48 of 48, build passes. Checked on desktop (1280px) and phone (390px): sign-in, home, properties, property page, review queue, My data, privacy notice.

## Not done
Not every screen was viewed (oversight, reports, case review and video screens use the same styles but were not individually checked after the change). A dark-mode switch. Real logo and brand colours if the company has them: send them and we change the tokens.
