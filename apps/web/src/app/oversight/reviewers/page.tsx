'use client';
import { useEffect, useState } from 'react';
import { useI18n } from '@/components/I18n';
import Loading from '@/components/Loading';
import PageHead from '@/components/PageHead';
import { MonthPicker, OversightTabs } from '@/components/OversightTabs';
import { api } from '@/lib/client';
import { currentMonth, fmtNum, fmtPct } from '@/lib/oversight';

export default function OversightReviewers() {
  const { t } = useI18n();
  const [month, setMonth] = useState(currentMonth()), [rep, setRep] = useState<any>(null), [denied, setDenied] = useState(false);
  useEffect(() => { setRep(null); api(`admin/reports/reviewers?month=${month}`).then((r) => { if (r.status === 403) setDenied(true); else setRep(r.data); }); }, [month]);
  if (denied) return <p className="error">{t('noAccess')}</p>;
  return (
    <>
      <PageHead eyebrow={t('appName')} title={t('ovTitle')} />
      <OversightTabs />
      <p className="msg">{t('ovAdvisory')}</p>
      <MonthPicker month={month} onChange={setMonth} />
      <p className="msg">{t('ovRvNote')}</p>
      {rep === null ? <Loading /> : rep.reviewers.length === 0 ? <div className="empty">{t('ovNoReviewers')}</div> : (
        <table className="table">
          <thead><tr><th>{t('ovAccountCol')}</th><th>{t('ovDecisions')}</th><th>{t('ovApproved')} / {t('ovRejected')}</th><th>{t('ovApprovalRate')}</th><th>{t('ovHours')}</th><th>{t('ovSentBack')}</th><th>{t('ovReleasedCol')}</th><th>{t('ovAlertsRaised')}</th></tr></thead>
          <tbody>{rep.reviewers.map((r: any) => (
            <tr key={r.reviewerId}>
              <td><strong>{r.account}</strong></td><td>{r.decisions}</td><td>{r.approved} / {r.rejected}</td>
              <td>{fmtPct(r.approvalRatePct)} <span className="msg">({t('ovSample')} {r.sampleSize})</span></td>
              <td>{fmtNum(r.handlingHours, 2)}</td><td>{r.sentBack}</td><td>{r.released}</td><td>{r.alertsRaised}</td>
            </tr>))}</tbody>
        </table>
      )}
    </>
  );
}
