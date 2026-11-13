// Draft privacy notice and terms. Words in [[double brackets]] are open points for the lawyer and are shown highlighted.
// Nothing here is in force until the company, the lawyer and NEXT_PUBLIC_LEGAL_PUBLISHED=true say so.
export type Lang = 'en' | 'sw';
export type Block = { h: string; p?: string[]; ul?: string[]; table?: { head: [string, string, string]; rows: [string, string, string][] } };
export interface CompanyInfo { name?: string; reg?: string; address?: string; contact?: string; published?: boolean }

export function companyInfo(env: Record<string, string | undefined> = {
  NEXT_PUBLIC_COMPANY_NAME: process.env.NEXT_PUBLIC_COMPANY_NAME, NEXT_PUBLIC_COMPANY_REG: process.env.NEXT_PUBLIC_COMPANY_REG,
  NEXT_PUBLIC_COMPANY_ADDRESS: process.env.NEXT_PUBLIC_COMPANY_ADDRESS, NEXT_PUBLIC_PRIVACY_CONTACT: process.env.NEXT_PUBLIC_PRIVACY_CONTACT,
  NEXT_PUBLIC_LEGAL_PUBLISHED: process.env.NEXT_PUBLIC_LEGAL_PUBLISHED,
}): CompanyInfo {
  const v = (k: string) => env[k]?.trim() || undefined;
  return { name: v('NEXT_PUBLIC_COMPANY_NAME'), reg: v('NEXT_PUBLIC_COMPANY_REG'), address: v('NEXT_PUBLIC_COMPANY_ADDRESS'), contact: v('NEXT_PUBLIC_PRIVACY_CONTACT'), published: env.NEXT_PUBLIC_LEGAL_PUBLISHED === 'true' };
}

const FALLBACK: Record<Lang, Record<'company' | 'reg' | 'address' | 'contact', string>> = {
  en: { company: '[[company name to be confirmed]]', reg: '[[registration number to be confirmed]]', address: '[[address to be confirmed]]', contact: '[[privacy contact to be confirmed]]' },
  sw: { company: '[[jina la kampuni litathibitishwa]]', reg: '[[namba ya usajili itathibitishwa]]', address: '[[anwani itathibitishwa]]', contact: '[[mawasiliano ya faragha yatathibitishwa]]' },
};
const fill = (s: string, lang: Lang, c: CompanyInfo) => s
  .replaceAll('{company}', c.name ?? FALLBACK[lang].company).replaceAll('{reg}', c.reg ?? FALLBACK[lang].reg)
  .replaceAll('{address}', c.address ?? FALLBACK[lang].address).replaceAll('{contact}', c.contact ?? FALLBACK[lang].contact);

const PRIVACY: Record<Lang, { title: string; blocks: Block[] }> = {
  en: {
    title: 'Privacy notice',
    blocks: [
      { h: 'Who we are', p: ['Zuri Home is run by {company} (registration {reg}, {address}). {company} decides how your personal information is used and is responsible for protecting it. This is called being the "data controller".', 'Questions about your information: {contact}.'] },
      { h: 'What Zuri Home does', p: ['Zuri Home connects landlords, agents and property managers with tenants and buyers, and checks property information so people can trust it.', 'A "verified" badge means a person at Zuri Home checked the documents we received (and, later, a short video). It is not a guarantee of ownership or of the condition of a property.'] },
      { h: 'What we collect and why', table: { head: ['What', 'Why', 'Notes'], rows: [
        ['Phone number and name', 'To sign you in and run your account', 'Sign-in codes expire after 5 minutes and are stored only in scrambled form'],
        ['Your organisation and role', 'To run organisation accounts and show who can do what', ''],
        ['Property documents (for example a title deed or a letter of authority)', 'To check that you may offer the property', 'They can contain details of owners. Only the reviewer of your case opens them, and each opening is recorded'],
        ['Result of an identity check', 'To confirm you are a real person', 'Not connected yet. When it is, we will not keep your ID number, only a scrambled fingerprint of it'],
        ['Video and location readings', 'To check the property exists and that you were near it', 'Switched off today. If switched on: one short live video and two location readings, at the start and end only. No tracking. Please do not film people or number plates'],
        ['Decisions and reasons', 'To keep a fair record of why a property was or was not verified', 'A person makes every decision. Computed hints only advise'],
        ['Activity record', 'To show who did what and when, so nobody can quietly change history', 'It cannot be edited. It holds identifiers, not your documents'],
        ['Your internet address', 'To stop one address from sending many sign-in codes or guesses', 'Kept only as a scrambled value and deleted after one day'],
      ] } },
      { h: 'Who can see your information', ul: [
        'Reviewers: only the cases they are reviewing. Every time a reviewer opens a document or video, it is recorded.',
        'Administrators: statistics and records of how the review work is going. They see names and phone numbers only to answer a privacy request, and each time they look, it is recorded.',
        'Service providers that help us run Zuri Home: hosting and storage on servers in Europe; text-message and WhatsApp providers, which receive your phone number and the sign-in message once connected; and an identity-check provider, once chosen.',
        'We do not sell your information.',
        '[[Lawyer to confirm the wording on sending information outside Kenya]]',
      ] },
      { h: 'How long we keep it', p: ['Our working plan is below. The periods marked as open will be fixed with our lawyer.'], ul: [
        'Sign-in codes: 5 minutes.',
        'Internet address checks: 1 day.',
        'Recordings that were never submitted: about 1 day.',
        'Videos (when switched on): 90 days after the final decision. [[Lawyer to confirm]]',
        'Documents, decisions and the activity record: [[period to be decided]]',
        'Reviewer time records and alerts: 24 months. [[Lawyer to confirm]]',
        'Your account: until you ask us to delete it, subject to the limits below.',
      ] },
      { h: 'Your rights', ul: [
        'See what we hold: use "My data" in the menu to download it.',
        'Ask us to correct it, or to delete it, on the same page. A person reads every request and gives a written answer.',
        'Some records may have to be kept, for example while a verification case is open or where the law requires it. If so, we will tell you why.',
        'Complain to the Office of the Data Protection Commissioner if you are not happy.',
        '[[Lawyer to confirm how quickly we must answer]]',
      ] },
      { h: 'Keeping your information safe', ul: [
        'Sign-in codes and session keys are stored only in scrambled form.',
        'Documents and videos are kept in private storage and opened only through short-lived links.',
        'The record of who opened what cannot be edited or deleted.',
        'No automatic decisions: a person decides every verification.',
      ] },
      { h: 'If you work as a reviewer', p: ['We record the time you spend on cases, your decisions and your approval rate. We do this to keep reviews fair and consistent and to understand costs. Alerts about unusual patterns are advice for a person: they never block you or change a case, and they are not used to pay or rank you. You can see your own figures. We do not record keystrokes or your screen. [[Lawyer to confirm the reviewer terms]]'] },
      { h: 'Changes and contact', p: ['If we change this notice in a way that matters to you, we will tell you in the app. Questions: {contact}.'] },
    ],
  },
  sw: {
    title: 'Taarifa ya faragha',
    blocks: [
      { h: 'Sisi ni nani', p: ['Zuri Home inaendeshwa na {company} (usajili {reg}, {address}). {company} inaamua jinsi taarifa zako binafsi zinavyotumika na inawajibika kuzilinda. Hii inaitwa "mdhibiti wa data".', 'Maswali kuhusu taarifa zako: {contact}.'] },
      { h: 'Zuri Home hufanya nini', p: ['Zuri Home inawaunganisha wenye nyumba, mawakala na wasimamizi wa mali na wapangaji na wanunuzi, na inakagua taarifa za mali ili watu waziamini.', 'Alama ya "imethibitishwa" ina maana mtu wa Zuri Home alikagua nyaraka tulizopokea (na baadaye, video fupi). Si hakikisho la umiliki wala hali ya mali.'] },
      { h: 'Tunakusanya nini na kwa nini', table: { head: ['Nini', 'Kwa nini', 'Maelezo'], rows: [
        ['Namba ya simu na jina', 'Kukuingiza na kuendesha akaunti yako', 'Nambari za kuingia huisha baada ya dakika 5 na huhifadhiwa kwa umbo lililofichwa tu'],
        ['Shirika lako na wadhifa', 'Kuendesha akaunti za mashirika na kuonyesha nani anaweza kufanya nini', ''],
        ['Nyaraka za mali (kwa mfano hati miliki au barua ya idhini)', 'Kuthibitisha kwamba unaruhusiwa kutoa mali', 'Zinaweza kuwa na taarifa za wamiliki. Ni mkaguzi wa kesi yako tu anayezifungua, na kila kufunguliwa kunarekodiwa'],
        ['Matokeo ya ukaguzi wa kitambulisho', 'Kuthibitisha kwamba wewe ni mtu halisi', 'Bado haijaunganishwa. Itakapounganishwa, hatutahifadhi namba yako ya kitambulisho, ila alama iliyofichwa tu'],
        ['Video na vipimo vya eneo', 'Kuthibitisha kwamba mali ipo na kwamba ulikuwa karibu nayo', 'Imezimwa kwa sasa. Ikiwashwa: video moja fupi ya moja kwa moja na vipimo viwili vya eneo, mwanzoni na mwishoni tu. Hakuna ufuatiliaji. Tafadhali usirekodi watu wala namba za magari'],
        ['Maamuzi na sababu', 'Kuweka kumbukumbu ya haki ya kwa nini mali ilithibitishwa au haikuthibitishwa', 'Mtu ndiye anayefanya kila uamuzi. Vidokezo vya kompyuta hushauri tu'],
        ['Kumbukumbu ya shughuli', 'Kuonyesha nani alifanya nini na lini, ili hakuna anayeweza kubadilisha historia kimya kimya', 'Haiwezi kuhaririwa. Ina vitambulisho, si nyaraka zako'],
        ['Anwani yako ya mtandao', 'Kuzuia anwani moja kutuma nambari nyingi za kuingia au kubahatisha', 'Huhifadhiwa kwa umbo lililofichwa tu na hufutwa baada ya siku moja'],
      ] } },
      { h: 'Nani anaweza kuona taarifa zako', ul: [
        'Wakaguzi: kesi wanazozikagua tu. Kila mkaguzi anapofungua nyaraka au video, hurekodiwa.',
        'Wasimamizi: takwimu na kumbukumbu za jinsi kazi ya ukaguzi inavyoendelea. Wanaona majina na namba za simu ili kujibu ombi la faragha tu, na kila wanapoangalia, hurekodiwa.',
        'Watoa huduma wanaotusaidia kuendesha Zuri Home: huduma za seva na hifadhi barani Ulaya; watoa huduma za ujumbe mfupi na WhatsApp, wanaopokea namba yako ya simu na ujumbe wa kuingia pindi wakiunganishwa; na mtoa huduma wa ukaguzi wa kitambulisho, atakapochaguliwa.',
        'Hatuuzi taarifa zako.',
        '[[Wakili athibitishe maneno kuhusu kutuma taarifa nje ya Kenya]]',
      ] },
      { h: 'Tunazihifadhi kwa muda gani', p: ['Mpango wetu wa sasa uko hapa chini. Vipindi vilivyoandikwa kuwa wazi vitaamuliwa na wakili wetu.'], ul: [
        'Nambari za kuingia: dakika 5.',
        'Ukaguzi wa anwani ya mtandao: siku 1.',
        'Rekodi ambazo hazikuwahi kutumwa: takriban siku 1.',
        'Video (zikiwashwa): siku 90 baada ya uamuzi wa mwisho. [[Wakili athibitishe]]',
        'Nyaraka, maamuzi na kumbukumbu ya shughuli: [[kipindi kitaamuliwa]]',
        'Kumbukumbu za muda wa wakaguzi na tahadhari: miezi 24. [[Wakili athibitishe]]',
        'Akaunti yako: hadi utakapotuomba kuifuta, kwa mipaka iliyo hapa chini.',
      ] },
      { h: 'Haki zako', ul: [
        'Kuona tulicho nacho: tumia "Data yangu" kwenye menyu kukipakua.',
        'Kutuomba tukirekebishe au tukifute, kwenye ukurasa huo huo. Mtu husoma kila ombi na kutoa jibu la maandishi.',
        'Baadhi ya rekodi zinaweza kuhitaji kuhifadhiwa, kwa mfano kesi ya uthibitishaji ikiwa wazi au sheria ikihitaji. Hivyo, tutakueleza kwa nini.',
        'Kulalamika kwa Ofisi ya Kamishna wa Ulinzi wa Data usiporidhika.',
        '[[Wakili athibitishe tunapaswa kujibu kwa haraka kiasi gani]]',
      ] },
      { h: 'Kuweka taarifa zako salama', ul: [
        'Nambari za kuingia na funguo za kikao huhifadhiwa kwa umbo lililofichwa tu.',
        'Nyaraka na video huhifadhiwa kwenye hifadhi ya faragha na hufunguliwa kwa viungo vya muda mfupi tu.',
        'Rekodi ya nani alifungua nini haiwezi kuhaririwa wala kufutwa.',
        'Hakuna maamuzi ya kiotomatiki: mtu ndiye anayeamua kila uthibitishaji.',
      ] },
      { h: 'Ukifanya kazi kama mkaguzi', p: ['Tunarekodi muda unaotumia kwenye kesi, maamuzi yako na kiwango chako cha kukubali. Tunafanya hivi ili ukaguzi uwe wa haki na thabiti na kuelewa gharama. Tahadhari kuhusu mienendo isiyo ya kawaida ni ushauri kwa mtu: hazikuzuii wala kubadilisha kesi, na hazitumiki kukulipa wala kukupanga. Unaweza kuona takwimu zako mwenyewe. Haturekodi vitufe unavyobonyeza wala skrini yako. [[Wakili athibitishe masharti ya wakaguzi]]'] },
      { h: 'Mabadiliko na mawasiliano', p: ['Tukibadilisha taarifa hii kwa namna inayokuhusu, tutakujulisha kwenye programu. Maswali: {contact}.'] },
    ],
  },
};

const TERMS: Record<Lang, { title: string; blocks: Block[] }> = {
  en: {
    title: 'Terms of use',
    blocks: [
      { h: 'About these terms', p: ['These terms are between you and {company}, which runs Zuri Home. By using Zuri Home you agree to them. [[Lawyer to complete and approve this text]]'] },
      { h: 'Using Zuri Home', ul: [
        'Give true information and keep your sign-in private.',
        'Only list or ask us to verify a property you are allowed to offer.',
        'Do not upload false or altered documents, or reuse a video from somewhere else.',
        'In a video check, do not film people or number plates.',
        'Do not misuse the service, for example by trying to get around its limits or checks.',
      ] },
      { h: 'Verification and badges', ul: [
        'A person at Zuri Home reviews your documents (and, later, a short video) and decides. Computed hints only advise.',
        'You will be told the reason if a request is turned down or needs changes, and you can appeal.',
        'A badge expires and can be withdrawn, for example if the information is found to be wrong.',
        'A badge is not a guarantee of ownership, price or the condition of a property.',
      ] },
      { h: 'Your documents and content', p: ['We use your documents and videos to check your property and to keep the records described in the privacy notice. We may remove content that breaks these terms.'] },
      { h: 'Fees', p: ['[[Fees to be decided and described here]]'] },
      { h: 'Our responsibility', p: ['[[Lawyer to draft the limits of responsibility]]'] },
      { h: 'Suspending or ending an account', p: ['We may suspend or end an account that breaks these terms. We will tell you why. You can ask us to delete your account from "My data" (see the privacy notice).'] },
      { h: 'Law and disputes', p: ['[[Lawyer to confirm the governing law and how disputes are handled]]'] },
      { h: 'Contact', p: ['{company}, {address}. {contact}.'] },
    ],
  },
  sw: {
    title: 'Masharti ya matumizi',
    blocks: [
      { h: 'Kuhusu masharti haya', p: ['Masharti haya ni kati yako na {company}, inayoendesha Zuri Home. Kwa kutumia Zuri Home unakubali. [[Wakili akamilishe na kuidhinisha maandishi haya]]'] },
      { h: 'Kutumia Zuri Home', ul: [
        'Toa taarifa za kweli na uweke siri ya kuingia kwako.',
        'Orodhesha au tuombe tuthibitishe mali unayoruhusiwa kuitoa tu.',
        'Usipakie nyaraka za uongo au zilizobadilishwa, wala kutumia tena video kutoka kwingine.',
        'Katika ukaguzi wa video, usirekodi watu wala namba za magari.',
        'Usitumie huduma vibaya, kwa mfano kwa kujaribu kukwepa mipaka au ukaguzi wake.',
      ] },
      { h: 'Uthibitishaji na alama', ul: [
        'Mtu wa Zuri Home hukagua nyaraka zako (na baadaye, video fupi) na kuamua. Vidokezo vya kompyuta hushauri tu.',
        'Utaambiwa sababu ikiwa ombi limekataliwa au linahitaji mabadiliko, na unaweza kukata rufaa.',
        'Alama huisha muda na inaweza kuondolewa, kwa mfano taarifa zikionekana kuwa si sahihi.',
        'Alama si hakikisho la umiliki, bei wala hali ya mali.',
      ] },
      { h: 'Nyaraka na maudhui yako', p: ['Tunatumia nyaraka na video zako kukagua mali yako na kuweka kumbukumbu zilizoelezwa kwenye taarifa ya faragha. Tunaweza kuondoa maudhui yanayokiuka masharti haya.'] },
      { h: 'Ada', p: ['[[Ada zitaamuliwa na kuelezwa hapa]]'] },
      { h: 'Wajibu wetu', p: ['[[Wakili aandike mipaka ya wajibu]]'] },
      { h: 'Kusimamisha au kufunga akaunti', p: ['Tunaweza kusimamisha au kufunga akaunti inayokiuka masharti haya. Tutakueleza kwa nini. Unaweza kutuomba tufute akaunti yako kupitia "Data yangu" (tazama taarifa ya faragha).'] },
      { h: 'Sheria na migogoro', p: ['[[Wakili athibitishe sheria inayotumika na jinsi migogoro inavyoshughulikiwa]]'] },
      { h: 'Mawasiliano', p: ['{company}, {address}. {contact}.'] },
    ],
  },
};

export const LEGAL_DOCS = ['privacy', 'terms'] as const;
export type LegalDoc = (typeof LEGAL_DOCS)[number];
export const DRAFT_BANNER: Record<Lang, string> = {
  en: 'DRAFT. This text is being reviewed by our lawyer and is not yet in force. Highlighted [[points]] are still open.',
  sw: 'RASIMU. Maandishi haya yanakaguliwa na wakili wetu na bado hayajaanza kutumika. [[Hoja]] zilizoangaziwa bado ziko wazi.',
};
export const LEGAL_LABELS: Record<Lang, { privacy: string; terms: string; updated: string; back: string }> = {
  en: { privacy: 'Privacy notice', terms: 'Terms of use', updated: 'Draft of November 2026', back: 'Back' },
  sw: { privacy: 'Taarifa ya faragha', terms: 'Masharti ya matumizi', updated: 'Rasimu ya Novemba 2026', back: 'Rudi' },
};

/** The document with the company details filled in. Anything not yet known shows as a highlighted [[to be confirmed]] marker. */
export function legalDoc(doc: LegalDoc, lang: Lang, c: CompanyInfo = companyInfo()): { title: string; blocks: Block[]; draft: boolean } {
  const src = (doc === 'privacy' ? PRIVACY : TERMS)[lang];
  const f = (s: string) => fill(s, lang, c);
  const blocks = src.blocks.map((b) => ({ h: b.h, p: b.p?.map(f), ul: b.ul?.map(f), table: b.table && { head: b.table.head, rows: b.table.rows.map((r) => r.map(f) as [string, string, string]) } }));
  // A published notice may not carry open points: until every marker is gone, it stays a draft.
  const open = JSON.stringify(blocks).includes('[[');
  return { title: src.title, blocks, draft: !c.published || open };
}
