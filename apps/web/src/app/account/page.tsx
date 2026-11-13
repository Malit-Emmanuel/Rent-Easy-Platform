'use client';
import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '@/components/I18n';
import PageHead from '@/components/PageHead';
import { api } from '@/lib/client';

/** "My data": download everything held about the signed-in person, and ask for a correction or deletion. A person answers every request. */
export default function MyData() {
  const { t } = useI18n(); const word = (k: string) => (t as any)(k) as string;
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState(''), [err, setErr] = useState('');
  const [reqs, setReqs] = useState<any[] | null>(null), [kind, setKind] = useState<'correction' | 'deletion'>('correction'), [details, setDetails] = useState('');
  const load = useCallback(async () => { const r = await api('me/data-requests'); setReqs(r.status === 200 ? (r.data as any[]) : []); }, []);
  useEffect(() => { load(); }, [load]);

  async function download() {
    setBusy(true); setMsg(''); setErr('');
    const r = await api('me/data-export');
    setBusy(false);
    if (r.status === 429) return setErr(t('drTooMany'));
    if (r.status !== 200 || !r.data) return setErr(t('genericError'));
    const url = URL.createObjectURL(new Blob([JSON.stringify(r.data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `zuri-home-my-data-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function send(e: React.FormEvent) {
    e.preventDefault(); setMsg(''); setErr('');
    if (kind === 'correction' && details.trim().length < 5) return setErr(t('drTooShort'));
    const r = await api('me/data-requests', { method: 'POST', body: { kind, details } });
    if (r.status === 201) { setMsg(t('drSent')); setDetails(''); load(); }
    else setErr(r.status === 409 ? t('drAlreadyOpen') : r.status === 400 ? t('drTooShort') : t('genericError'));
  }
  return (
    <>
      <PageHead eyebrow={t('appName')} title={t('drTitle')} />
      <p className="msg">{t('drIntro')}</p>
      <section className="card">
        <h2>{t('drDownloadH')}</h2>
        <p className="msg">{t('drDownloadHint')}</p>
        <button onClick={download} disabled={busy}>{busy ? t('drDownloading') : t('drDownload')}</button>
      </section>
      <section className="card">
        <h2>{t('drRequestH')}</h2>
        <form onSubmit={send}>
          <label htmlFor="pv-kind">{t('drKind')}</label>
          <select id="pv-kind" value={kind} onChange={(e) => setKind(e.target.value as any)}>
            <option value="correction">{t('drKindCorrection')}</option><option value="deletion">{t('drKindDeletion')}</option>
          </select>
          <label htmlFor="pv-details">{t('drDetails')}</label>
          <textarea id="pv-details" rows={4} maxLength={1000} value={details} onChange={(e) => setDetails(e.target.value)} aria-describedby="pv-hint" />
          <p id="pv-hint" className="msg">{kind === 'correction' ? t('drDetailsCorrectionHint') : t('drDetailsDeletionHint')}</p>
          {kind === 'deletion' && <p className="msg">{t('drDeletionNote')}</p>}
          <button type="submit">{t('drSend')}</button>
        </form>
      </section>
      {msg && <p className="msg" role="status">{msg}</p>}{err && <p className="error" role="alert">{err}</p>}
      <h2>{t('drMyRequests')}</h2>
      {reqs === null ? <p className="msg">{t('loading')}</p> : reqs.length === 0 ? <div className="empty">{t('drNoRequests')}</div> : reqs.map((r) => (
        <article className="card" key={r.id}>
          <div className="row"><strong>{word(r.kind === 'correction' ? 'drKindCorrection' : 'drKindDeletion')}</strong>
            <span className={`vstate ${r.status === 'open' ? 'wait' : r.status === 'completed' ? 'ok' : 'bad'}`}>{word('drStatus_' + r.status)}</span>
            <span className="spacer" /><span className="msg">{t('drSentOn')} {new Date(r.createdAt).toLocaleDateString()}</span></div>
          {r.details && <p>{r.details}</p>}
          {r.resolutionNote && <p><strong>{t('drAnswer')}:</strong> {r.resolutionNote}</p>}
        </article>
      ))}
    </>
  );
}
