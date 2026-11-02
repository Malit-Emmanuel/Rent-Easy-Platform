'use client';
import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useI18n } from '@/components/I18n';
import PageHead from '@/components/PageHead';
import { api } from '@/lib/client';
import { span } from '@/lib/span';

interface Row { id: string; status: string; propertyName: string; address: string; orgName: string; submittedAt: string; minutesLeft: number | null; breached: boolean; riskFlags: string[]; isAppeal: boolean; fileCount: number; claimedByMe: boolean }

const REASONS = ['doc_unreadable', 'doc_owner_mismatch', 'doc_expired', 'authorisation_missing', 'property_mismatch', 'suspected_forgery', 'other'];

/** Active badges a reviewer can withdraw. Needs a reason code; "other" needs a note. */
function VerifiedProperties() {
  const { t } = useI18n(); const word = (k: string) => (t as any)(k) as string;
  const [rows, setRows] = useState<any[] | null>(null), [open, setOpen] = useState<string | null>(null), [reason, setReason] = useState('doc_expired'), [note, setNote] = useState(''), [msg, setMsg] = useState(''), [err, setErr] = useState('');
  const load = useCallback(async () => { const r = await api('review/badges'); setRows(r.status === 200 ? r.data : []); }, []);
  useEffect(() => { load(); }, [load]);
  async function revoke(e: FormEvent, id: string) {
    e.preventDefault(); setErr(''); setMsg('');
    if (!window.confirm(t('rvRevokeConfirm'))) return;
    const r = await api(`review/badges/${id}/revoke`, { method: 'POST', body: { reasonCode: reason, ...(note.trim() ? { note: note.trim() } : {}) } });
    if (r.status === 200) { setOpen(null); setNote(''); setMsg(t('rvRevoked')); load(); } else setErr(reason === 'other' && !note.trim() ? t('rvNeedNote') : t('genericError'));
  }
  if (rows === null) return null;
  return (
    <section>
      <h2>{t('rvBadges')}</h2>
      <p className="msg">{t('rvBadgesHint')}</p>
      {rows.length === 0 ? <div className="empty">{t('rvNoBadges')}</div> : (
        <table className="table">
          <thead><tr><th>{t('rvProperty')}</th><th>{t('rvOrg')}</th><th>{t('rvExpires')}</th><th /></tr></thead>
          <tbody>{rows.map((b) => (
            <tr key={b.id}>
              <td><strong>{b.propertyName}</strong><div className="msg">{b.address}</div></td><td>{b.orgName}</td><td>{new Date(b.expiresAt).toLocaleDateString()}</td>
              <td className="actions">{open === b.id ? (
                <form onSubmit={(e) => revoke(e, b.id)} style={{ textAlign: 'left', minWidth: 240 }}>
                  <label htmlFor={'rr' + b.id}>{t('pvReason')}</label>
                  <select id={'rr' + b.id} value={reason} onChange={(e) => setReason(e.target.value)}>{REASONS.map((x) => <option key={x} value={x}>{word('rc_' + x)}</option>)}</select>
                  <label htmlFor={'rn' + b.id}>{t('pvNote')} {reason === 'other' ? '' : `(${t('optional')})`}</label>
                  <textarea id={'rn' + b.id} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} required={reason === 'other'} />
                  <div className="row"><button className="danger">{t('rvRevoke')}</button><button type="button" className="link" onClick={() => setOpen(null)}>{t('rvCancel')}</button></div>
                </form>
              ) : <button type="button" className="link" onClick={() => { setOpen(b.id); setErr(''); setMsg(''); }}>{t('rvRevoke')}</button>}</td>
            </tr>))}</tbody>
        </table>
      )}
      {msg && <p className="msg" role="status">{msg}</p>}
      {err && <p className="error" role="alert">{err}</p>}
    </section>
  );
}

export default function ReviewQueue() {
  const { t } = useI18n(); const word = (k: string) => (t as any)(k) as string;
  const [rows, setRows] = useState<Row[] | null>(null), [denied, setDenied] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState('');
  const load = useCallback(async () => {
    const r = await api('review/cases/queue');
    if (r.status === 403) { setDenied(true); return; }
    setRows(r.data ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function act(id: string, what: 'claim' | 'release') {
    setBusy(id); setError('');
    const r = await api(`review/cases/${id}/${what}`, { method: 'POST' });
    setBusy('');
    if (r.status === 409) setError(t('rvTaken'));
    else if (r.status !== 200) setError(t('genericError'));
    load();
  }

  if (denied) return <p className="error">{t('noAccess')}</p>;
  return (
    <>
      <PageHead eyebrow={t('appName')} title={t('rvTitle')} />
      <p className="msg">{t('rvHint')}</p>
      {rows === null ? <p className="msg">{t('loading')}</p> : rows.length === 0 ? <div className="empty">{t('rvEmpty')}</div> : (
        <table className="table">
          <thead><tr><th>{t('rvProperty')}</th><th>{t('rvOrg')}</th><th>{t('rvTimeLeft')}</th><th>{t('rvFlags')}</th><th /></tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td><strong>{c.propertyName}</strong><div className="msg">{c.address} · {c.fileCount} {t('rvDocs')}</div></td>
                <td>{c.orgName}</td>
                <td>{c.minutesLeft === null ? '–' : <span className={`vstate ${c.breached ? 'bad' : c.minutesLeft < 24 * 60 ? 'wait' : 'none'}`}>{c.breached ? `${t('rvOverdue')} ${span(c.minutesLeft)}` : `${span(c.minutesLeft)} ${t('rvLeft')}`}</span>}</td>
                <td>{c.isAppeal && <span className="badge">{t('rvAppeal')}</span>}{' '}{c.riskFlags.filter((f) => f !== 'appeal').map((f) => <span className="badge" key={f}>{word('flag_' + f)}</span>)}</td>
                <td className="actions">
                  {c.claimedByMe ? (<><Link href={`/review/${c.id}`}><button type="button">{t('rvOpenCase')}</button></Link><span className="vstate ok">{t('rvMine')}</span><button type="button" className="link" disabled={busy === c.id} onClick={() => act(c.id, 'release')}>{t('rvRelease')}</button></>)
                    : <button type="button" disabled={busy === c.id} onClick={() => act(c.id, 'claim')}>{t('rvClaim')}</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      <VerifiedProperties />
    </>
  );
}
