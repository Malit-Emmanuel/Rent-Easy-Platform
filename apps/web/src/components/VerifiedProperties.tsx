'use client';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useI18n } from '@/components/I18n';
import { api } from '@/lib/client';

const REASONS = ['doc_unreadable', 'doc_owner_mismatch', 'doc_expired', 'authorisation_missing', 'property_mismatch', 'suspected_forgery', 'other'];

/** Active badges a reviewer can withdraw. Needs a reason code; "other" needs a note. */
export default function VerifiedProperties() {
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

