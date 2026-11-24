'use client';
import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '@/components/I18n';
import Loading from '@/components/Loading';
import PageHead from '@/components/PageHead';
import { MonthPicker, OversightTabs } from '@/components/OversightTabs';
import { api } from '@/lib/client';
import { currentMonth, fmtNum, fmtPct, shortId } from '@/lib/oversight';

const AGE_KEYS = ['under1Day', 'days1to2', 'days2to3', 'over3Days'];

export default function OversightOverview() {
  const { t } = useI18n();
  const [month, setMonth] = useState(currentMonth()), [rep, setRep] = useState<any>(null), [stale, setStale] = useState<any>(null), [denied, setDenied] = useState(false);
  const [reason, setReason] = useState<Record<string, string>>({}), [msg, setMsg] = useState(''), [err, setErr] = useState('');
  const loadStale = useCallback(async () => { const r = await api('admin/review/stale-claims'); if (r.status === 403) setDenied(true); else setStale(r.data); }, []);
  useEffect(() => { setRep(null); api(`admin/reports/queue?month=${month}`).then((r) => { if (r.status === 403) setDenied(true); else setRep(r.data); }); }, [month]);
  useEffect(() => { loadStale(); }, [loadStale]);
  async function release(id: string) {
    setMsg(''); setErr('');
    const r = await api(`admin/review/cases/${id}/release`, { method: 'POST', body: { reason: reason[id] ?? '' } });
    if (r.status === 200) { setMsg(t('ovReleased')); loadStale(); } else setErr(r.status === 409 ? t('ovReleaseTooSoon') : t('genericError'));
  }
  if (denied) return <p className="error">{t('noAccess')}</p>;
  return (
    <>
      <PageHead eyebrow={t('appName')} title={t('ovTitle')} />
      <OversightTabs />
      <p className="msg">{t('ovAdvisory')}</p>
      <MonthPicker month={month} onChange={setMonth} />
      {rep === null ? <Loading /> : (
        <>
          {(['t1', 't2'] as const).map((tier) => { const x = rep.tiers[tier]; return (
            <section className="card" key={tier} aria-labelledby={`h-${tier}`}>
              <h2 id={`h-${tier}`}>{t(tier === 't1' ? 'ovT1' : 'ovT2')}</h2>
              <div className="stats">
                <div className="stat"><b>{x.received}</b><span>{t('ovReceived')}</span></div>
                <div className="stat"><b>{x.decided}</b><span>{t('ovDecided')} ({x.approved} / {x.rejected})</span></div>
                <div className="stat"><b>{fmtPct(x.onTimePct.value)}</b><span>{t('ovOnTime')} · {t('ovSample')} {x.onTimePct.sampleSize}</span></div>
                <div className="stat"><b>{x.deadlineBreaches.overdueNow}</b><span>{t('ovOverdueNow')}</span></div>
              </div>
              <table className="table"><tbody>
                <tr><td>{t('ovMedWait')}</td><td>{fmtNum(x.medianWaitMinutes.value)} <span className="msg">({t('ovSample')} {x.medianWaitMinutes.sampleSize})</span></td></tr>
                <tr><td>{t('ovMedHandling')}</td><td>{fmtNum(x.medianHandlingMinutes.value)} <span className="msg">({t('ovSample')} {x.medianHandlingMinutes.sampleSize})</span></td></tr>
                <tr><td>{t('ovLate')}</td><td>{x.deadlineBreaches.decidedLate}</td></tr>
                <tr><td>{t('ovReturned')}</td><td>{x.returnedForChanges}</td></tr>
                <tr><td>{t('ovAppeals')}</td><td>{x.appeals.filed} / {x.appeals.decided} / {x.appeals.overturned}</td></tr>
              </tbody></table>
              <h3>{t('ovQueueNow')}</h3>
              <p>{t('ovWaiting')}: <strong>{x.queueNow.waiting}</strong> · {t('ovInReview')}: <strong>{x.queueNow.inReview}</strong> · {t('ovNeedsChanges')}: <strong>{x.queueNow.needsChanges}</strong></p>
              <p className="msg">{AGE_KEYS.map((k) => `${t('ovAge_' + k)}: ${x.queueNow.waitingByAge[k]}`).join(' · ')}</p>
            </section>); })}
          <p className="msg">{t('ovTimeNote')}</p>
        </>
      )}
      <section className="card" aria-labelledby="h-stale">
        <h2 id="h-stale">{t('ovStale')}</h2>
        {stale && <p className="msg">{t('ovStaleHint').replace('{h}', String(stale.thresholdHours))}</p>}
        {stale === null ? <Loading /> : stale.claims.length === 0 ? <div className="empty">{t('ovNoStale')}</div> : (
          <table className="table">
            <thead><tr><th>{t('rvTitle')}</th><th>{t('ovAccountCol')}</th><th>{t('ovHeld')}</th><th>{t('ovReleaseReason')}</th><th /></tr></thead>
            <tbody>{stale.claims.map((c: any) => (
              <tr key={c.id}>
                <td><code>{shortId(c.id)}</code> <span className="badge">{t(c.tier === 't2' ? 'ovT2' : 'ovT1')}</span>{c.breached && <> <span className="vstate bad">{t('ovOverdueNow')}</span></>}</td>
                <td>{c.account}</td><td>{c.heldMinutes}</td>
                <td><input aria-label={t('ovReleaseReason')} value={reason[c.id] ?? ''} maxLength={500} onChange={(e) => setReason({ ...reason, [c.id]: e.target.value })} /></td>
                <td className="actions"><button disabled={(reason[c.id] ?? '').trim().length < 5} onClick={() => release(c.id)}>{t('ovRelease')}</button></td>
              </tr>))}</tbody>
          </table>
        )}
        {msg && <p className="msg" role="status">{msg}</p>}{err && <p className="error" role="alert">{err}</p>}
      </section>
    </>
  );
}
