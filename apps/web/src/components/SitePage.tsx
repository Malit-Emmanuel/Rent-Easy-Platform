'use client';
import Link from 'next/link';
import { useI18n } from '@/components/I18n';
import { companyInfo } from '@/lib/legal';
import { SITE, SITE_LABELS, type SiteName } from '@/lib/site';

/** The public pages: no sign-in, no calls to the API. The notice about testing shows until the company says the product is open. */
export default function SitePage({ doc }: { doc: SiteName }) {
  const { lang } = useI18n(); const d = SITE[doc][lang], L = SITE_LABELS[lang];
  const testing = !companyInfo().published;
  const secondary = doc === 'welcome' ? '/verified' : '/welcome';
  return (
    <article className="landing">
      {testing && <p className="notice" role="note">{L.testing}</p>}
      <header className="hero2">
        <h1>{d.title}</h1>
        <p className="lead">{d.lead}</p>
        <p className="row"><Link className="btn" href="/login">{d.cta}</Link><Link className="btn ghost" href={secondary}>{d.ctaMore}</Link></p>
      </header>
      {d.sections.map((s, i) => (
        <section key={i}>
          <h2>{s.h}</h2>
          {s.intro && <p>{s.intro} <Link href="/privacy">{L.privacy}</Link></p>}
          {s.items && <div className="steps">{s.items.map((it, j) => <div className="step" key={j}><strong>{it.h}</strong><p>{it.p}</p></div>)}</div>}
          {s.list && <ul className={s.no ? 'ticks no' : 'ticks'}>{s.list.map((x, j) => <li key={j}>{x}</li>)}</ul>}
        </section>
      ))}
    </article>
  );
}
