'use client';
import Link from 'next/link';
import { useI18n } from '@/components/I18n';
import { DRAFT_BANNER, LEGAL_LABELS, legalDoc, type LegalDoc as Doc } from '@/lib/legal';

/** Text with [[open points]] shown highlighted so nobody mistakes a draft for the final wording. */
function Marked({ text }: { text: string }) {
  return <>{text.split(/(\[\[.*?\]\])/g).map((s, i) => s.startsWith('[[') ? <mark key={i} className="todo">{s.slice(2, -2)}</mark> : <span key={i}>{s}</span>)}</>;
}

export default function LegalDocView({ doc }: { doc: Doc }) {
  const { lang } = useI18n(); const L = LEGAL_LABELS[lang];
  const d = legalDoc(doc, lang);
  return (
    <article className="legal">
      <p><Link className="crumb" href="/">← {L.back}</Link></p>
      <h1>{d.title}</h1>
      {d.draft && <p className="draft" role="note"><Marked text={DRAFT_BANNER[lang]} /></p>}
      <p className="msg">{L.updated}</p>
      <nav className="tabs" aria-label="Legal"><Link href="/privacy" className={doc === 'privacy' ? 'on' : ''} aria-current={doc === 'privacy' ? 'page' : undefined}>{L.privacy}</Link><Link href="/terms" className={doc === 'terms' ? 'on' : ''} aria-current={doc === 'terms' ? 'page' : undefined}>{L.terms}</Link></nav>
      {d.blocks.map((b, i) => (
        <section key={i}>
          <h2>{i + 1}. {b.h}</h2>
          {b.p?.map((x, j) => <p key={j}><Marked text={x} /></p>)}
          {b.table && <div className="tablewrap"><table className="table"><thead><tr>{b.table.head.map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{b.table.rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k}><Marked text={c} /></td>)}</tr>)}</tbody></table></div>}
          {b.ul && <ul>{b.ul.map((x, j) => <li key={j}><Marked text={x} /></li>)}</ul>}
        </section>
      ))}
    </article>
  );
}
