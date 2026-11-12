'use client';
import { useEffect, useState } from 'react';
import { useI18n } from '@/components/I18n';
import PageHead from '@/components/PageHead';
import ReviewTabs from '@/components/ReviewTabs';
import { MonthPicker } from '@/components/OversightTabs';
import { api } from '@/lib/client';
import { currentMonth, fmtNum, fmtPct } from '@/lib/oversight';

export default function MyStats() {
  const { t } = useI18n();
  const [month, setMonth] = useState(currentMonth()), [s, setS] = useState<any>(null), [denied, setDenied] = useState(false);
  useEffect(() => { setS(null); api(`review/cases/my-stats?month=${month}`).then((r) => { if (r.status === 403) setDenied(true); else setS(r.data); }); }, [month]);
  if (denied) return <p className="error">{t('noAccess')}</p>;
  return (
    <>
      <PageHead eyebrow={t('appName')} title={t('rvTitle')} />
      <ReviewTabs />
      <p className="msg">{t('rvStatsHint')}</p>
      <MonthPicker month={month} onChange={setMonth} />
      {s === null ? <p className="msg">{t('loading')}</p> : s.decisions === 0 && s.sessions === 0 ? <div className="empty">{t('rvStatsEmpty')}</div> : (
        <>
          <div className="stats">
            <div className="stat"><b>{s.decisions}</b><span>{t('rvStatsDecisions')}</span></div>
            <div className="stat"><b>{s.approved}</b><span>{t('rvStatsApproved')}</span></div>
            <div className="stat"><b>{s.rejected}</b><span>{t('rvStatsRejected')}</span></div>
            <div className="stat"><b>{fmtPct(s.approvalRatePct)}</b><span>{t('rvStatsRate')} · {t('ovSample')} {s.sampleSize}</span></div>
          </div>
          <table className="table"><tbody>
            <tr><td>{t('rvStatsByTier')}</td><td>{s.t1} / {s.t2}</td></tr>
            <tr><td>{t('rvStatsHours')}</td><td>{fmtNum(s.handlingHours, 2)}</td></tr>
            <tr><td>{t('rvStatsMedian')}</td><td>{fmtNum(s.medianHandlingMinutes)} <span className="msg">({t('ovSample')} {s.medianSampleSize})</span></td></tr>
            <tr><td>{t('rvStatsSentBack')}</td><td>{s.sentBack}</td></tr>
            <tr><td>{t('rvStatsReleased')}</td><td>{s.released}</td></tr>
          </tbody></table>
        </>
      )}
    </>
  );
}
