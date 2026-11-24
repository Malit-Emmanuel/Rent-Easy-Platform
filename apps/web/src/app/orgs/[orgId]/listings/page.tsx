'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useI18n } from '@/components/I18n';
import Loading from '@/components/Loading';
import EmptyState from '@/components/EmptyState';
import PageHead from '@/components/PageHead';
import { STATUS_KEY, statusClass, statusKey } from '@/components/ListingPanel';
import { api } from '@/lib/client';

const kes = (n: number | null) => (n === null ? '–' : `KES ${n.toLocaleString('en-KE')}`);

export default function Listings() {
  const { t } = useI18n();
  const { orgId } = useParams<{ orgId: string }>();
  const [items, setItems] = useState<any[] | null>(null), [status, setStatus] = useState(''), [denied, setDenied] = useState(false);
  useEffect(() => {
    (async () => {
      const r = await api(`orgs/${orgId}/listings${status ? `?status=${status}` : ''}`);
      if (r.status === 403) { setDenied(true); return; }
      setItems(r.data ?? []);
    })();
  }, [orgId, status]);
  if (denied) return <p className="error">{t('noAccess')}</p>;
  return (
    <>
      <PageHead back={{ href: `/orgs/${orgId}/properties`, label: t('properties') }} eyebrow={t('overview')} title={t('ls_listings')} />
      <p className="msg">{t('ls_notPublicYet')}</p>
      {(items ?? []).some((l) => l.status === 'stale' || l.phase === 'remind') && <p className="error" role="status">{t('ls_needAttention')}</p>}
      <div className="toolbar">
        <select aria-label={t('ls_all')} value={status} onChange={(e) => { setItems(null); setStatus(e.target.value); }}>
          <option value="">{t('ls_all')}</option>
          {Object.entries(STATUS_KEY).map(([k, v]) => <option key={k} value={k}>{t(v as any)}</option>)}
        </select>
      </div>
      {items === null ? <Loading /> : items.length === 0 ? <EmptyState title={t('ls_noneTitle')}>{t('ls_noneBody')}</EmptyState> : (
        <table className="table">
          <thead><tr><th>{t('properties')}</th><th>{t('unitLabel')}</th><th>{t('bedrooms')}</th><th>{t('ls_total')}</th><th>{t('ls_listing')}</th></tr></thead>
          <tbody>
            {items.map((l) => (
              <tr key={l.id}>
                <td><Link href={`/orgs/${orgId}/properties/${l.propertyId}`}><strong>{l.propertyName}</strong></Link>{l.nodeName ? <div className="msg">{l.nodeName}</div> : null}</td>
                <td>{l.unitLabel}</td><td>{l.bedrooms === 0 ? t('bedsitter') : l.bedrooms}</td><td>{kes(l.totalMoveIn)}</td>
                <td><span className={`vstate ${statusClass(l.status, l.phase)}`}>{t(statusKey(l) as any)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
