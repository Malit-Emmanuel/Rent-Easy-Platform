'use client';
import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '@/components/I18n';
import { api } from '@/lib/client';

type Status = {
  verified: boolean; verifiedUntil: string | null; canRequest: boolean; missingProof: string[]; appealWindowDays: number;
  case: null | { status: string; dueAt: string | null; reasonCode: string | null; note: string | null; canAppeal: boolean; canResubmit?: boolean; isAppeal?: boolean };
};

export default function VerificationCard({ orgId, propertyId, canWrite }: { orgId: string; propertyId: string; canWrite: boolean }) {
  const { t } = useI18n(); const url = `orgs/${orgId}/properties/${propertyId}/verification`;
  const [s, setS] = useState<Status | null>(null), [msg, setMsg] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  const load = useCallback(async () => { const r = await api(url); if (r.status === 200) setS(r.data); }, [url]);
  useEffect(() => { load(); }, [load]);
  if (!s) return null;

  const word = (k: string) => (t as any)(k);
  const c = s.case;
  const label = s.verified ? t('pvApproved') : !c ? t('pvNone') : c.status === 'submitted' && c.isAppeal ? t('pvAppealOpen') : word('pv' + c.status.charAt(0).toUpperCase() + c.status.slice(1));
  const tone = s.verified ? 'ok' : c?.status === 'rejected' ? 'bad' : c ? 'wait' : 'none';

  async function go(path: string, done: string) {
    setBusy(true); setErr(''); setMsg('');
    const r = await api(path, { method: 'POST' });
    setBusy(false);
    if (r.status === 201) { setMsg(done); load(); return; }
    const code = r.data?.code;
    if (code === 'id_not_verified') setErr(t('pvIdNeeded'));
    else if (code === 'proof_missing') { setErr(t('pvMissingTitle')); load(); }
    else if (r.status === 409) setErr(t('pvAlreadyOpen'));
    else setErr(t('genericError'));
  }

  return (
    <section className="panel vcard" aria-labelledby="pv-h">
      <div className="row between"><h2 id="pv-h">{t('propVerif')}</h2><span className={`vstate ${tone}`}>{label}</span></div>
      {s.verified && s.verifiedUntil && <p className="msg">{t('pvVerifiedUntil')} {new Date(s.verifiedUntil).toLocaleDateString()}</p>}
      {!s.verified && c && ['submitted', 'in_review'].includes(c.status) && c.dueAt && <p className="msg">{t('pvDue')} {new Date(c.dueAt).toLocaleDateString()}. {t('pvEvidenceFrozen')}</p>}
      {c && ['rejected', 'needs_changes'].includes(c.status) && (
        <p className="msg"><strong>{t('pvReason')}:</strong> {c.reasonCode ? word('rc_' + c.reasonCode) : ''}{c.note ? <><br /><strong>{t('pvNote')}:</strong> {c.note}</> : null}</p>
      )}
      {canWrite && s.canRequest && s.missingProof.length > 0 && (
        <div className="msg"><strong>{t('pvMissingTitle')}</strong><ul>{s.missingProof.map((m) => <li key={m}>{word('pvMissing_' + m)}</li>)}</ul></div>
      )}
      {canWrite && s.canRequest && <button disabled={busy || s.missingProof.length > 0} onClick={() => go(url, t('pvRequested'))}>{t('pvRequest')}</button>}
      {canWrite && c?.canAppeal && (<><p className="msg">{t('pvAppealHint').replace('{n}', String(s.appealWindowDays))}</p><button disabled={busy} onClick={() => go(`${url}/appeal`, t('pvAppealed'))}>{t('pvAppeal')}</button></>)}
      {canWrite && c?.canResubmit && (<><p className="msg">{t('pvResubmitHint')}</p><button disabled={busy} onClick={() => go(`${url}/resubmit`, t('pvResubmitted'))}>{t('pvResubmit')}</button></>)}
      {msg && <p className="msg" role="status">{msg}</p>}
      {err && <p className="error" role="alert">{err}</p>}
    </section>
  );
}
