'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useI18n } from './I18n';
import { api } from '@/lib/client';
import { LEGAL_LABELS } from '@/lib/legal';

type Item = { doc: 'privacy' | 'terms'; version: string; accepted: boolean };

/**
 * Shown only when the operator has put a version of the privacy notice or terms in force (API variables POLICY_*_VERSION) and this person
 * has not accepted it yet. Until then the API lists nothing and this renders nothing. It never blocks the app: whether it should is a legal decision.
 */
export default function PolicyBanner() {
  const { t, lang } = useI18n(); const L = LEGAL_LABELS[lang];
  const [items, setItems] = useState<Item[]>([]), [busy, setBusy] = useState(false), [err, setErr] = useState(false);
  useEffect(() => { api('me/policies').then((r) => { if (r.status === 200 && r.data) setItems((r.data as any).items ?? []); }); }, []);
  const open = items.filter((i) => !i.accepted);
  if (!open.length) return null;
  const accept = async () => {
    setBusy(true); setErr(false);
    let last: any = null;
    for (const i of open) { last = await api('me/policies/accept', { method: 'POST', body: { doc: i.doc, version: i.version, lang } }); if (last.status !== 200) break; }
    setBusy(false);
    if (last?.status === 200) setItems((last.data as any).items ?? []); else setErr(true);
  };
  return (
    <div className="notice" role="region" aria-label="Privacy notice and terms">
      <p>{t('paBanner')}</p>
      <p><Link href="/privacy" target="_blank">{L.privacy}</Link>{' · '}<Link href="/terms" target="_blank">{L.terms}</Link></p>
      <p><button disabled={busy} onClick={accept}>{t('paAccept')}</button></p>
      {err && <p className="error" role="alert">{t('paFailed')}</p>}
    </div>
  );
}
