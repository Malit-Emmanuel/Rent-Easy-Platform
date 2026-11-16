// Public pages: the home page and "What does Verified mean?". Plain words, English and Swahili.
// Rules for this text: no numbers or claims that are not true today, no promised times, and nothing that is not built is described as working.
import type { Lang } from './legal';

export interface Item { h: string; p: string }
export interface SiteDoc {
  title: string; lead: string; cta: string; ctaMore: string;
  sections: { h: string; intro?: string; items?: Item[]; list?: string[]; no?: boolean }[];
}
export type SiteName = 'welcome' | 'verified';
export const SITE_NAMES: SiteName[] = ['welcome', 'verified'];

export const SITE: Record<SiteName, Record<Lang, SiteDoc>> = {
  welcome: {
    en: {
      title: 'Rentals you can trust',
      lead: 'Zuri Home helps landlords, agents and property managers show that their properties are real, so that people can look for a home with less worry.',
      cta: 'Sign in', ctaMore: 'What does "Verified" mean?',
      sections: [
        { h: 'How it works', items: [
          { h: '1. Add your property', p: 'Create an organisation, add your properties and units, one by one or from a spreadsheet.' },
          { h: '2. Send your documents', p: 'Upload the papers that show you are allowed to offer the property, for example a title deed and a letter of authority.' },
          { h: '3. A person checks them', p: 'A trained reviewer reads your documents and decides. You always get a reason, and you can ask for a second look.' },
          { h: '4. Get your badge', p: 'An approved property gets a "Verified" badge. It expires, so it stays up to date.' },
        ] },
        { h: 'Who it is for', items: [
          { h: 'Landlords, agents and property managers', p: 'Show that your properties are real and that you may offer them. Available now in test.' },
          { h: 'Tenants and buyers', p: 'Soon you will be able to look for properties that have been checked. This part is not ready yet.' },
        ] },
        { h: 'Our promises', items: [
          { h: 'People decide', p: 'Every verification is decided by a person. Computer hints only advise.' },
          { h: 'Fair and explained', p: 'If a request is turned down, you are told why, and you can appeal.' },
          { h: 'Your information is protected', p: 'Only the reviewer of your case sees your documents, and every time they are opened it is recorded.' },
          { h: 'Reviewers cannot check their own', p: 'A reviewer never sees cases from their own organisations.' },
        ] },
      ],
    },
    sw: {
      title: 'Nyumba za kupanga unazoweza kuziamini',
      lead: 'Zuri Home huwasaidia wenye nyumba, mawakala na wasimamizi wa mali kuonyesha kwamba mali zao ni halisi, ili watu watafute makazi bila wasiwasi mwingi.',
      cta: 'Ingia', ctaMore: '"Imethibitishwa" ina maana gani?',
      sections: [
        { h: 'Inavyofanya kazi', items: [
          { h: '1. Ongeza mali yako', p: 'Fungua shirika, ongeza mali na vyumba vyako, moja moja au kutoka lahajedwali.' },
          { h: '2. Tuma nyaraka zako', p: 'Pakia nyaraka zinazoonyesha kwamba unaruhusiwa kutoa mali hiyo, kwa mfano hati miliki na barua ya idhini.' },
          { h: '3. Mtu huzikagua', p: 'Mkaguzi aliyefunzwa husoma nyaraka zako na kuamua. Kila mara unapewa sababu, na unaweza kuomba kuangaliwa tena.' },
          { h: '4. Pata alama yako', p: 'Mali iliyokubaliwa hupata alama ya "Imethibitishwa". Alama huisha muda, ili ibaki ya kisasa.' },
        ] },
        { h: 'Ni ya nani', items: [
          { h: 'Wenye nyumba, mawakala na wasimamizi wa mali', p: 'Onyesha kwamba mali zako ni halisi na kwamba unaruhusiwa kuzitoa. Inapatikana sasa kwa majaribio.' },
          { h: 'Wapangaji na wanunuzi', p: 'Hivi karibuni utaweza kutafuta mali zilizokaguliwa. Sehemu hii bado haijakamilika.' },
        ] },
        { h: 'Ahadi zetu', items: [
          { h: 'Watu huamua', p: 'Kila uthibitishaji huamuliwa na mtu. Vidokezo vya kompyuta hushauri tu.' },
          { h: 'Haki na kuelezwa', p: 'Ombi likikataliwa, unaambiwa kwa nini, na unaweza kukata rufaa.' },
          { h: 'Taarifa zako zinalindwa', p: 'Ni mkaguzi wa kesi yako tu anayeona nyaraka zako, na kila zinapofunguliwa hurekodiwa.' },
          { h: 'Wakaguzi hawakagui mali zao wenyewe', p: 'Mkaguzi haoni kesi za mashirika yake mwenyewe.' },
        ] },
      ],
    },
  },
  verified: {
    en: {
      title: 'What does "Verified" mean?',
      lead: 'A Verified badge means a person at Zuri Home checked the documents we received for a property and found them in order. Here is exactly what that does and does not mean.',
      cta: 'Sign in', ctaMore: 'Back to home',
      sections: [
        { h: 'What we check', items: [
          { h: 'Document check', p: 'A reviewer reads the papers the manager uploaded, for example the title deed and a letter of authority, and decides whether they show that the person may offer the property.' },
          { h: 'Short video check (coming later)', p: 'Later, the manager will record one short live video at the property. This is switched off today and will start only after our lawyer clears it.' },
        ] },
        { h: 'What a badge means', list: [
          'A person looked at the documents we received and found them in order on the day of the decision.',
          'The decision and its reason are recorded, and every opening of a document is recorded.',
          'The badge has an end date. When it ends, the property needs to be checked again.',
        ] },
        { h: 'What a badge does not mean', no: true, list: [
          'It is not a guarantee of ownership, of the price, or of the condition of the property.',
          'It does not replace your own checks before you pay or sign anything.',
          'It does not mean we have visited the property, unless a video check is shown.',
        ] },
        { h: 'If something is wrong', list: [
          'A badge can be withdrawn if the information is found to be wrong. The reason is recorded.',
          'If a request is turned down or needs changes, the manager is told the reason and can appeal. A different reviewer looks again.',
          'Reviewers never check cases from their own organisations.',
        ] },
        { h: 'Your information', intro: 'Read how we handle personal information in the privacy notice.' },
      ],
    },
    sw: {
      title: '"Imethibitishwa" ina maana gani?',
      lead: 'Alama ya Imethibitishwa ina maana mtu wa Zuri Home alikagua nyaraka tulizopokea kuhusu mali na kuziona ziko sawa. Hapa kuna maelezo kamili ya inachomaanisha na isichomaanisha.',
      cta: 'Ingia', ctaMore: 'Rudi mwanzo',
      sections: [
        { h: 'Tunachokagua', items: [
          { h: 'Ukaguzi wa nyaraka', p: 'Mkaguzi husoma nyaraka alizopakia msimamizi, kwa mfano hati miliki na barua ya idhini, na kuamua kama zinaonyesha kwamba mtu huyo anaruhusiwa kutoa mali.' },
          { h: 'Ukaguzi wa video fupi (baadaye)', p: 'Baadaye, msimamizi atarekodi video moja fupi ya moja kwa moja kwenye mali. Hii imezimwa leo na itaanza tu baada ya wakili wetu kuruhusu.' },
        ] },
        { h: 'Alama inamaanisha nini', list: [
          'Mtu alitazama nyaraka tulizopokea na kuziona ziko sawa siku ya uamuzi.',
          'Uamuzi na sababu yake hurekodiwa, na kila nyaraka inapofunguliwa hurekodiwa.',
          'Alama ina tarehe ya mwisho. Ikiisha, mali inahitaji kukaguliwa tena.',
        ] },
        { h: 'Alama haimaanishi nini', no: true, list: [
          'Si hakikisho la umiliki, bei, wala hali ya mali.',
          'Haichukui nafasi ya ukaguzi wako mwenyewe kabla ya kulipa au kusaini chochote.',
          'Haimaanishi tumetembelea mali, isipokuwa ukaguzi wa video umeonyeshwa.',
        ] },
        { h: 'Kukiwa na tatizo', list: [
          'Alama inaweza kuondolewa ikiwa taarifa zitaonekana kuwa si sahihi. Sababu hurekodiwa.',
          'Ombi likikataliwa au likihitaji mabadiliko, msimamizi anaambiwa sababu na anaweza kukata rufaa. Mkaguzi tofauti huangalia tena.',
          'Wakaguzi hawakagui kesi za mashirika yao wenyewe.',
        ] },
        { h: 'Taarifa zako', intro: 'Soma jinsi tunavyoshughulikia taarifa binafsi katika taarifa ya faragha.' },
      ],
    },
  },
};

export const SITE_LABELS: Record<Lang, { testing: string; privacy: string; terms: string; verified: string; home: string; footer: string }> = {
  en: { testing: 'Zuri Home is being tested and is not open to the public yet.', privacy: 'Privacy notice', terms: 'Terms of use', verified: 'What does "Verified" mean?', home: 'Home', footer: 'Verified rentals' },
  sw: { testing: 'Zuri Home iko kwenye majaribio na bado haijafunguliwa kwa umma.', privacy: 'Taarifa ya faragha', terms: 'Masharti ya matumizi', verified: '"Imethibitishwa" ina maana gani?', home: 'Mwanzo', footer: 'Nyumba zilizothibitishwa' },
};
