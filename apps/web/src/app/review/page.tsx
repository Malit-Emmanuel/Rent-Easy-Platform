'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '@/components/I18n';
import Loading from '@/components/Loading';
import PageHead from '@/components/PageHead';
import ReviewTabs from '@/components/ReviewTabs';
import { api } from '@/lib/client';
import { span } from '@/lib/span';

interface Row { id: string; status: string; propertyName: string; address: string; orgName: string; submittedAt: string; minutesLeft: number | null; breached: boolean; riskFlags: string[]; tier: string; isAppeal: boolean; fileCount: number; claimedByMe: boolean }

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
      <ReviewTabs />
      {rows && rows.length > 0 && (
        <div className="stats three">
          <div className="stat"><b>{rows.filter((c) => !c.claimedByMe).length}</b><span>{t('rvWaiting')}</span></div>
          <div className="stat"><b>{rows.filter((c) => c.breached).length}</b><span>{t('rvOverdueCount')}</span></div>
          <div className="stat"><b>{rows.filter((c) => c.claimedByMe).length}</b><span>{t('rvYouHold')}</span></div>
        </div>
      )}
      <p className="msg">{t('rvHint')}</p>
      {rows === null ? <Loading /> : rows.length === 0 ? <div className="empty">{t('rvEmpty')}</div> : (
        <table className="table">
          <thead><tr><th>{t('rvProperty')}</th><th>{t('rvOrg')}</th><th>{t('rvTimeLeft')}</th><th>{t('rvFlags')}</th><th /></tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td><strong>{c.propertyName}</strong>{c.tier === 't2' && <> <span className="badge">{t('flag_t2')}</span></>}<div className="msg">{c.address} · {c.fileCount} {t('rvDocs')}</div></td>
                <td>{c.orgName}</td>
                <td>{c.minutesLeft === null ? '–' : <span className={`vstate ${c.breached ? 'bad' : c.minutesLeft < 24 * 60 ? 'wait' : 'none'}`}>{c.breached ? `${t('rvOverdue')} ${span(c.minutesLeft)}` : `${span(c.minutesLeft)} ${t('rvLeft')}`}</span>}</td>
                <td>{c.isAppeal && <span className="badge">{t('rvAppeal')}</span>}{' '}{c.riskFlags.filter((f) => f !== 'appeal' && f !== 't2').map((f) => <span className="badge" key={f}>{word('flag_' + f)}</span>)}</td>
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
    </>
  );
}
