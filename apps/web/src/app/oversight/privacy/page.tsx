'use client';
import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '@/components/I18n';
import PageHead from '@/components/PageHead';
import { OversightTabs } from '@/components/OversightTabs';
import { api } from '@/lib/client';

/** Administrators decide people's correction and deletion requests. Deciding only records the decision; nothing here changes data. */
export default function PrivacyRequests() {
  const { t } = useI18n(); const word = (k: string) => (t as any)(k) as string;
  const [filter, setFilter] = useState('open'), [rows, setRows] = useState<any[] | null>(null), [denied, setDenied] = useState(false);
  const [note, setNote] = useState<Record<string, string>>({}), [msg, setMsg] = useState(''), [err, setErr] = useState('');
  const load = useCallback(async () => {
    const r = await api(`admin/privacy/requests${filter === 'open' ? '?status=open' : ''}`);
    if (r.status === 403) { setDenied(true); return; }
    setRows((r.data as any)?.requests ?? []);
  }, [filter]);
  useEffect(() => { load(); }, [load]);
  async function handle(id: string, status: 'completed' | 'declined') {
    setMsg(''); setErr('');
    const r = await api(`admin/privacy/requests/${id}/handle`, { method: 'POST', body: { status, note: note[id] ?? '' } });
    if (r.status === 200) { setMsg(t('drHandled')); setNote({ ...note, [id]: '' }); load(); } else setErr(r.status === 409 ? t('drNotAllowed') : t('genericError'));
  }
  if (denied) return <p className="error">{t('noAccess')}</p>;
  return (
    <>
      <PageHead eyebrow={t('appName')} title={t('ovTitle')} />
      <OversightTabs />
      <p className="msg">{t('drAdminHint')}</p>
      <div className="toolbar">
        <label htmlFor="pf">{t('status')}</label>
        <select id="pf" value={filter} onChange={(e) => { setRows(null); setFilter(e.target.value); }}>
          <option value="open">{t('drFOpen')}</option><option value="all">{t('drFAll')}</option>
        </select>
      </div>
      {msg && <p className="msg" role="status">{msg}</p>}{err && <p className="error" role="alert">{err}</p>}
      {rows === null ? <p className="msg">{t('loading')}</p> : rows.length === 0 ? <div className="empty">{t('drNoAdmin')}</div> : rows.map((r) => (
        <article className="card" key={r.id}>
          <div className="row"><strong>{word(r.kind === 'correction' ? 'drKindCorrection' : 'drKindDeletion')}</strong>
            <span className={`vstate ${r.status === 'open' ? 'wait' : r.status === 'completed' ? 'ok' : 'bad'}`}>{word('drStatus_' + r.status)}</span>
            <span className="spacer" /><span className="msg">{t('drSentOn')} {new Date(r.createdAt).toLocaleString()}</span></div>
          <p className="msg">{t('drWho')}: {r.fullName ?? '-'} · {r.phone}</p>
          {r.details && <p>{r.details}</p>}
          {r.resolutionNote && <p><strong>{t('drAnswer')}:</strong> {r.resolutionNote}</p>}
          {r.status === 'open' && (r.isYours ? <p className="msg">{t('drYours')}</p> : (
            <>
              <label htmlFor={`n-${r.id}`}>{t('drNoteLabel')}</label>
              <textarea id={`n-${r.id}`} rows={3} maxLength={1000} value={note[r.id] ?? ''} onChange={(e) => setNote({ ...note, [r.id]: e.target.value })} />
              <div className="row">
                <button onClick={() => handle(r.id, 'completed')} disabled={(note[r.id] ?? '').trim().length < 5}>{t('drComplete')}</button>
                <button className="secondary" onClick={() => handle(r.id, 'declined')} disabled={(note[r.id] ?? '').trim().length < 5}>{t('drDecline')}</button>
              </div>
            </>
          ))}
        </article>
      ))}
    </>
  );
}
