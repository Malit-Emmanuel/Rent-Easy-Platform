'use client';
import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '@/components/I18n';
import PageHead from '@/components/PageHead';
import { OversightTabs } from '@/components/OversightTabs';
import { api } from '@/lib/client';
import { figureEntries, shortId } from '@/lib/oversight';

export default function OversightAlerts() {
  const { t } = useI18n(); const word = (k: string) => (t as any)(k) as string;
  const [filter, setFilter] = useState('open'), [alerts, setAlerts] = useState<any[] | null>(null), [rules, setRules] = useState<any[] | null>(null), [denied, setDenied] = useState(false);
  const [note, setNote] = useState<Record<string, string>>({}), [edit, setEdit] = useState<Record<string, { threshold: string; minSample: string }>>({}), [msg, setMsg] = useState(''), [err, setErr] = useState('');
  const load = useCallback(async () => {
    const [a, r] = await Promise.all([api(`admin/integrity/alerts?status=${filter}`), api('admin/integrity/rules')]);
    if (a.status === 403 || r.status === 403) { setDenied(true); return; }
    setAlerts(a.data ?? []); setRules(r.data ?? []);
  }, [filter]);
  useEffect(() => { load(); }, [load]);
  async function handle(id: string, status: string) {
    setMsg(''); setErr('');
    const r = await api(`admin/integrity/alerts/${id}/handle`, { method: 'POST', body: { status, note: note[id] ?? '' } });
    if (r.status === 200) { setMsg(t('ovHandled')); setNote({ ...note, [id]: '' }); load(); } else setErr(r.status === 409 ? t('ovNotAllowed') : t('genericError'));
  }
  async function saveRule(code: string, body: Record<string, unknown>) {
    setMsg(''); setErr('');
    const r = await api(`admin/integrity/rules/${code}`, { method: 'PATCH', body });
    if (r.status === 200) { setMsg(t('ovRuleSaved')); load(); } else setErr(r.status === 409 ? t('ovNotAvailable') : t('genericError'));
  }
  if (denied) return <p className="error">{t('noAccess')}</p>;
  return (
    <>
      <PageHead eyebrow={t('appName')} title={t('ovTitle')} />
      <OversightTabs />
      <p className="msg">{t('ovAdvisory')}</p>
      <p className="msg">{t('ovAlertsHint')}</p>
      <div className="toolbar">
        <label htmlFor="af">{t('status')}</label>
        <select id="af" value={filter} onChange={(e) => { setAlerts(null); setFilter(e.target.value); }}>
          <option value="open">{t('ovFOpen')}</option><option value="live">{t('ovFLive')}</option><option value="all">{t('ovFAll')}</option>
        </select>
      </div>
      {msg && <p className="msg" role="status">{msg}</p>}{err && <p className="error" role="alert">{err}</p>}
      {alerts === null ? <p className="msg">{t('loading')}</p> : alerts.length === 0 ? <div className="empty">{t('ovNoAlerts')}</div> : alerts.map((a) => {
        const live = a.status === 'open' || a.status === 'escalated';
        return (
          <article className="card" key={a.id}>
            <div className="row">
              <strong>{word('ovrule_' + a.rule)}</strong><span className="badge">{t('ovAdviceOnly')}</span>
              <span className={`vstate ${a.status === 'open' ? 'wait' : a.status === 'escalated' ? 'bad' : 'ok'}`}>{word('ovas_' + a.status)}</span>
              <span className="spacer" /><span className="msg">{a.account} · {t('ovRaised')} {new Date(a.raisedAt).toLocaleString()}</span>
            </div>
            <p className="msg">{a.description}</p>
            <table className="table"><tbody>
              {figureEntries(a.figures).map((f) => <tr key={f.key}><td>{word('fig_' + f.key)}</td><td>{f.value}</td></tr>)}
              {a.caseIds.length > 0 && <tr><td>{t('ovCases')}</td><td>{a.caseIds.map((c: string) => <code key={c} style={{ marginRight: 8 }}>{shortId(c)}</code>)}</td></tr>}
            </tbody></table>
            {a.handlerNote && <p className="msg">{t('ovNote')}: {a.handlerNote}</p>}
            {live && (
              <div className="toolbar">
                <input aria-label={t('ovHandlerNote')} placeholder={t('ovHandlerNote')} style={{ flex: 1 }} value={note[a.id] ?? ''} maxLength={500} onChange={(e) => setNote({ ...note, [a.id]: e.target.value })} />
                {(() => { const ok = (note[a.id] ?? '').trim().length >= 5; return (<>
                  <button disabled={!ok} onClick={() => handle(a.id, 'acknowledged')}>{t('ovAckn')}</button>
                  <button disabled={!ok} onClick={() => handle(a.id, 'dismissed')}>{t('ovDismiss')}</button>
                  {a.status === 'open' && <button className="danger" disabled={!ok} onClick={() => handle(a.id, 'escalated')}>{t('ovEscalate')}</button>}
                </>); })()}
              </div>
            )}
          </article>);
      })}
      <section className="card" aria-labelledby="h-rules">
        <h2 id="h-rules">{t('ovRules')}</h2>
        <p className="msg">{t('ovRulesHint')}</p>
        {rules && (
          <table className="table">
            <thead><tr><th>{t('ovRule')}</th><th>{t('ovThreshold')}</th><th>{t('ovMinSample')}</th><th>{t('ovEnabled')}</th><th /></tr></thead>
            <tbody>{rules.map((r) => { const e = edit[r.code] ?? { threshold: String(r.threshold), minSample: String(r.minSample) }; const dirty = e.threshold !== String(r.threshold) || e.minSample !== String(r.minSample); return (
              <tr key={r.code}>
                <td>{word('ovrule_' + r.code)}<div className="msg">{r.unit}</div></td>
                <td><input aria-label={`${word('ovrule_' + r.code)}: ${t('ovThreshold')}`} inputMode="decimal" value={e.threshold} disabled={!r.available} onChange={(x) => setEdit({ ...edit, [r.code]: { ...e, threshold: x.target.value } })} /></td>
                <td><input aria-label={`${word('ovrule_' + r.code)}: ${t('ovMinSample')}`} inputMode="numeric" value={e.minSample} disabled={!r.available} onChange={(x) => setEdit({ ...edit, [r.code]: { ...e, minSample: x.target.value } })} /></td>
                <td>{r.available ? <input type="checkbox" style={{ width: 'auto' }} aria-label={`${word('ovrule_' + r.code)}: ${t('ovEnabled')}`} checked={r.enabled} onChange={(x) => saveRule(r.code, { enabled: x.target.checked })} /> : <span className="msg">{t('ovNotAvailable')}</span>}</td>
                <td className="actions"><button disabled={!dirty || !r.available || !Number.isFinite(Number(e.threshold)) || e.threshold.trim() === '' || !/^\d+$/.test(e.minSample)} onClick={() => saveRule(r.code, { threshold: Number(e.threshold), minSample: Number(e.minSample) })}>{t('ovSaveRule')}</button></td>
              </tr>); })}</tbody>
          </table>
        )}
      </section>
    </>
  );
}
