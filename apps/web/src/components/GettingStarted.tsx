'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useI18n } from '@/components/I18n';

const KEY = 'edupato.gettingStarted.hidden';
function readHidden(): boolean { try { return window.localStorage.getItem(KEY) === '1'; } catch { return false; } }
function writeHidden(v: boolean) { try { if (v) window.localStorage.setItem(KEY, '1'); else window.localStorage.removeItem(KEY); } catch { /* private window: it simply comes back next time */ } }

export interface StartState { hasOrg: boolean; hasProperties: boolean; idVerified: boolean; orgHref?: string; firstPropertyHref?: string }

/** Four plain steps for a new manager. The first three tick themselves from real data; the fourth is a pointer. */
export default function GettingStarted({ s }: { s: StartState }) {
  const { t } = useI18n();
  const [hidden, setHidden] = useState(false), [ready, setReady] = useState(false);
  useEffect(() => { setHidden(readHidden()); setReady(true); }, []);
  const done = [s.hasOrg, s.hasProperties, s.idVerified];
  const allDone = done.every(Boolean);
  if (!ready) return null;
  if (hidden) {
    return allDone ? null : <p className="msg"><button type="button" className="link" onClick={() => { setHidden(false); writeHidden(false); }}>{t('gsShow')}</button></p>;
  }
  const next = done.findIndex((d) => !d);
  const steps: { title: string; hint: string; href?: string; check: boolean | null }[] = [
    { title: t('gsStep1'), hint: t('gsStep1Hint'), href: s.hasOrg ? undefined : '#create-org', check: s.hasOrg },
    { title: t('gsStep2'), hint: t('gsStep2Hint'), href: s.hasOrg && !s.hasProperties ? s.orgHref : undefined, check: s.hasProperties },
    { title: t('gsStep3'), hint: t('gsStep3Hint'), href: s.idVerified ? undefined : '/verification', check: s.idVerified },
    { title: t('gsStep4'), hint: t('gsStep4Hint'), href: s.firstPropertyHref, check: null },
  ];
  return (
    <section className="card gs" aria-labelledby="gs-title">
      <div className="row"><h2 id="gs-title" style={{ margin: 0 }}>{t('gsTitle')}</h2><span className="spacer" />
        <button type="button" className="link" onClick={() => { setHidden(true); writeHidden(true); }}>{t('gsHide')}</button></div>
      <p className="msg">{t('gsIntro')}</p>
      <ol className="gs-steps">
        {steps.map((st, i) => (
          <li key={i} className={st.check ? 'done' : i === next ? 'now' : ''}>
            <span className="gs-mark" aria-hidden="true">{st.check ? '✓' : i + 1}</span>
            <span className="gs-body"><strong>{st.title}</strong>{st.check ? <span className="sr-only"> ({t('gsDone')})</span> : null}<br /><span className="msg">{st.hint}</span>
              {st.href && !st.check && (st.href.startsWith('#') ? <a className="gs-go" href={st.href}>{t('gsGo')} →</a> : <Link className="gs-go" href={st.href}>{t('gsGo')} →</Link>)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
