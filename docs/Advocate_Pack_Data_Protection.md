# Advocate Pack: Data Protection for Zuri Home (Kenya Housing Connection Platform)

**Purpose.** This is a plain-language description of what the platform collects, why, where it goes and how long it stays, with the questions we need the advocate to answer before any real property video or real ID check goes live. It is a draft for legal review. It is **not** legal advice, and the references to the Data Protection Act, 2019 are our understanding, to be confirmed.

**Status of the product.** Test only. Video verification is switched off (`T2_ENABLED` off). No real tenants, managers' IDs or property videos are processed. Please keep it that way until you have cleared the points in section 6.

## 1. Who is who (to be confirmed)
| Role | Our understanding | To confirm |
|---|---|---|
| Data controller | The company that will own Zuri Home (not yet registered) | Company name, registration, ODPC registration as controller |
| Data processors | Hosting and service providers (section 4) | Written processing contracts with each |
| Data subjects | Managers, landlords and agents; property owners named in documents; anyone accidentally filmed | Whether tenants and buyers are in scope later |

## 2. What we collect and why
| Data | Where it comes from | Purpose | Sensitive? (our view, to confirm) |
|---|---|---|---|
| Phone number | Sign-in | Identify the account; send one-time codes by WhatsApp or SMS | Personal data |
| Name, organisation, role | Manager sign-up | Run the organisation account | Personal data |
| ID verification result (provider not yet chosen) | A third-party ID provider | Confirm a manager is a real person before property verification | ID number and selfie/face match are likely **sensitive** (biometric) |
| Property documents (title deed, lease, letter of authority) | Manager upload | T1 verification: does this manager have the right to offer this property | Personal data of owners; may include ID numbers |
| **Property video with audio** (30 to 90 seconds) | Manager records live in the phone browser | T2 verification: is the property really there and was the manager at it | Voice is personal data; people or number plates may be filmed by accident |
| **Two location readings** (latitude, longitude, accuracy, time) | The phone, at the start and end of the recording only | Check the manager was near the property | Location data; **no continuous tracking** |
| Video fingerprint (SHA-256 of the file) | Computed by our server | Detect the same video being reused | Not meaningful alone |
| Computed notes (distance bands, "reused video", etc.) | Computed by our server | Advice to the human reviewer; never decides | Derived data |
| Reviewer decision, reason, checklist answers | Reviewer | The record of the decision | Personal data of the reviewer and the manager |
| Access log and audit trail | Our server | Prove who opened what and when; tamper-evident | Reviewer identifiers |

## 3. How the video and location flow works (for the notice wording)
1. The manager sees a notice and must tick a consent box before a code is issued. The notice tells them to film only at the property, not to film people or number plates, and says what we keep and for how long. *(Wording is ours; please review.)*
2. They record 30 to 90 seconds, saying a 4-digit code and showing the entrance, street and one chosen unit. They can watch it back and retake up to 3 times; only the submitted take is kept.
3. Location is read **twice only**: at the start and at the end of the recording. There is no background or continuous tracking.
4. Only reviewers can open the video, through a link that works for **5 minutes**; every opening is logged. A reviewer cannot review a case from an organisation they belong to.
5. A person always decides. Computed checks are advice and are never shown to the manager.
6. The manager sees the reason and note of a decision but never who decided.

## 4. Where data lives (technical facts)
| Service | Used for | Region |
|---|---|---|
| Supabase (Postgres database and file storage) | Accounts, cases, documents, videos | **To confirm** (project region) |
| Railway | API server and Redis | Amsterdam (EU) |
| Vercel | Web app | Global edge network (to confirm which regions handle requests) |
| Africa's Talking / Meta WhatsApp | One-time codes | Not yet live; Kenya or international |
| ID verification provider | ID and selfie checks | Not yet chosen |

Every database table has row-level security switched on with no public access; the API is the only route in. Videos are in private storage and only reachable through short-lived signed links.

## 5. Retention (provisional)
| Data | Current setting | Note |
|---|---|---|
| Raw T2 video | **90 days after the case is decided** (one setting in the database) | The deletion job is **built** (S5e) and runs once a day: it removes the stored video and marks the file deleted. The case, the two location readings, the reviewer checklist, the decision and the video's fingerprint (a hash, not the video) are kept. A video under an open appeal is not deleted until the appeal is decided. Please advise on the right period, and on whether the fingerprint may be kept longer |
| Recordings that were never submitted | **About 24 hours after the code expired** (the daily job). Earlier takes in a session are discarded when a retake is made | Confirm |
| Cases left at "record again" that the manager never answers | **Not yet decided**: the video currently stays until a decision is made | Please advise on an end date |
| Property documents (T1) | No end date is set yet | Please advise |
| T1 documents | Kept while the case and badge are active | No end date set. Please advise |
| Location readings, fingerprint, computed notes, checklist | Kept with the case record | Please advise; readings are location data |
| Audit trail and access log | Append-only, kept | Contains identifiers, no coordinates or codes. Please advise on period |
| Phone numbers and accounts | Until the user asks for deletion | Deletion process not built yet |

## 6. Questions for the advocate (please answer before real data)
1. **ODPC registration.** Must the company register as a data controller and/or processor before launch? What does it need from us?
2. **Lawful basis and consent.** Is explicit consent in the in-app notice enough for video, voice and location, and for ID and face data? What must the notice say? Do we need separate consents?
3. **Impact assessment (DPIA).** Is a DPIA required for video, location and biometric ID checks? Draft headings are in section 7. Who signs it?
4. **Sensitive data.** Are the ID number, selfie/face match and voice "sensitive personal data" here, and what extra conditions apply?
5. **Cross-border processing.** Hosting is in the EU and a global edge network. What is required for transfers out of Kenya (consent, safeguards, written contracts)? Is any of this data subject to local storage rules?
6. **Retention.** Is 90 days for video acceptable? What should the periods be for documents, readings, audit records and accounts?
7. **People accidentally filmed.** Is the notice (do not film people or number plates) enough? What do we do if footage shows a person or a plate? Should reviewers blur or discard?
8. **Reviewer access.** Is a logged, time-limited link enough? Do reviewers need confidentiality agreements and training? The platform currently has one real reviewer; a second is needed.
9. **Subject rights.** How should we handle access, correction and deletion requests, including requests to delete a video that is evidence in an open case?
10. **Breach response.** We understand a breach must be notified to the Data Commissioner within 72 hours. What is the process and who is the contact?
11. **Third-party providers.** What must be in the contracts with the hosting, messaging and ID providers? Is the provider's claim that "no consent is required" safe to rely on? (We do not rely on it.)
12. **Property documents.** Which documents are acceptable proof of the right to offer a property? Our current rule (title deed or lease, plus a letter of authority for agents) is a placeholder.
13. **Data protection officer.** Do we need to appoint one?
14. **Notices and terms.** Please review the video notice, the privacy notice and the terms of use (to be written).

## 7. Draft DPIA headings (to be completed with the advocate)
1. Description of processing (sections 2 and 3 above).
2. Necessity and proportionality: why video and location rather than documents alone; why two readings and not tracking; why 30 to 90 seconds.
3. Risks to people: wrongful rejection, misuse of video by a reviewer, accidental filming of third parties, leak of location, spoofed location giving false assurance, bias in ID/face checks, exclusion of managers without smartphones.
4. Measures: consent notice, minimum collection, private storage, short links, access log, no self-review, human decision, appeal to a different reviewer, retention limit, row-level security, hash-chained audit trail.
5. Residual risks and sign-off.

## 8. What we will not do without your clearance
- Switch real video verification on.
- Run real ID checks.
- Send real one-time codes to the public.
- Keep any real video beyond the period you approve.
