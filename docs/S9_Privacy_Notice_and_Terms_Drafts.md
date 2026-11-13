# S9: Privacy notice and terms (drafts)

Public pages at `/privacy` and `/terms`, in English and Swahili. No sign-in needed. Linked from the sign-in page and from "My data".

## Status
DRAFT for legal review. Not in force. A yellow banner shows on both pages, and every open point appears highlighted as [[text]].

## How the draft behaves
- Company name, registration number, address and privacy contact come from `NEXT_PUBLIC_COMPANY_NAME`, `NEXT_PUBLIC_COMPANY_REG`, `NEXT_PUBLIC_COMPANY_ADDRESS`, `NEXT_PUBLIC_PRIVACY_CONTACT` (Vercel variables). Until set, they show as highlighted "to be confirmed" markers.
- The draft banner stays on until `NEXT_PUBLIC_LEGAL_PUBLISHED=true` AND no [[open point]] is left in the text. Setting the flag alone cannot publish an unfinished notice.
- Text lives in `apps/web/src/lib/legal.ts`; tests in `legal.test.ts` check English/Swahili match, no empty text, markers visible, details filled in.

## Open points for the lawyer (marked in the text)
Sending information outside Kenya; retention for documents, decisions and the activity record; 90-day video and 24-month alert/time-record periods; answer deadline for privacy requests; reviewer terms; fees; limits of responsibility; governing law and disputes; whole terms text.

## Not done
Consent recording at sign-in (needs lawyer wording). Swahili wording of these two pages needs the native-speaker review.
