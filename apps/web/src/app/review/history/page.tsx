'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useI18n } from '@/components/I18n';
import PageHead from '@/components/PageHead';
import ReviewTabs from '@/components/ReviewTabs';
import { api } from '@/lib/client';

export default function HistoryPage() {
  const { t } = useI18n(); const word = (k: string) => (t as any)(k) as string;
  const [rows, setRows] = useState<any[] | null>(null), [denied, setDenied] = useState(false);
  useEffect(() => { api('review/cases/history').then((r) => { if (r.status === 403) setDenied(true); else setRows(r.data ?? []); }); }, []);
  if (denied) return <p className="error">{t('noAccess')}</p>;
  return (
    <>
      <PageHead eyebrow={t('appName')} title={t('rvTitle')} />
      <ReviewTabs />
      <p className="msg">{t('rvHistoryHint')}</p>
      {rows === null ? <p className="msg">{t('loading')}</p> : rows.length === 0 ? <div className="empty">{t('rvHistoryEmpty')}</div> : (
        <table className="table">
          <thead><tr><th>{t('rvWhen')}</th><th>{t('rvProperty')}</th><th>{t('rvOrg')}</th><th>{t('rvOutcome')}</th></tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={r.id + r.kind + i}>
              <td>{new Date(r.at).toLocaleString()}</td>
              <td><strong>{r.propertyName}</strong>{r.isAppeal && <> <span className="badge">{t('rvAppeal')}</span></>}</td>
              <td>{r.orgName}</td>
              <td><span className={`vstate ${r.kind === 'approved' ? 'ok' : r.kind === 'needs_changes' ? 'wait' : 'bad'}`}>{word('rvk_' + r.kind)}</span>{r.reasonCode && <div className="msg">{word('rc_' + r.reasonCode)}</div>}</td>
            </tr>))}</tbody>
        </table>
      )}
    </>
  );
}
