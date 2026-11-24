'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useI18n } from '@/components/I18n';
import EmptyState from '@/components/EmptyState';
import { day, kes } from '@/components/HomeCard';
import Loading from '@/components/Loading';

const ROWS = ['rent', 'deposit', 'utilityDeposit', 'serviceCharge', 'agentFee'] as const;

export default function Home() {
  const { t } = useI18n();
  const { id } = useParams<{ id: string }>();
  const [h, setH] = useState<any>(null), [state, setState] = useState<'load' | 'ok' | 'gone' | 'error'>('load');
  useEffect(() => {
    fetch(`/api/public/listings/${id}`, { cache: 'no-store' }).then(async (r) => {
      if (r.status === 404) { setState('gone'); return; }
      if (!r.ok) { setState('error'); return; }
      setH(await r.json()); setState('ok');
    }).catch(() => setState('error'));
  }, [id]);
  if (state === 'load') return <Loading />;
  if (state === 'gone') return <EmptyState title={t('hm_goneTitle')} href="/homes" action={t('hm_backToSearch')}>{t('hm_goneBody')}</EmptyState>;
  if (state === 'error') return <p className="error" role="alert">{t('genericError')}</p>;
  return (
    <>
      <Link className="crumb" href="/homes">← {t('hm_backToSearch')}</Link>
      <p className="eyebrow">{h.area ?? t('hm_noArea')}</p>
      <div className="row"><h1 style={{ margin: '4px 0 12px' }}>{h.propertyName}</h1><span className="spacer" />{h.verifiedUntil && <span className="vstate ok">{t('hm_checked')}</span>}</div>
      <p>{h.bedrooms === 0 ? t('bedsitter') : `${h.bedrooms} ${t('hm_bed')}`}{h.floor ? ` · ${t('floor')} ${h.floor}` : ''}</p>
      <div className="panel hm-costs" role="group" aria-label={t('hm_costs')}>
        {ROWS.map((k) => <div key={k}><span>{t(`ls_${k}` as any)}</span><span>{kes(h.costs[k])}</span></div>)}
        <div className="hm-sum"><strong>{t('hm_totalToMove')}</strong><strong>{kes(h.totalMoveIn)}</strong></div>
      </div>
      <p className="msg">{t('hm_costsNote')}</p>
      <p className="msg">{t('hm_confirmedOn')} {day(h.confirmedAt)}</p>
      {h.verifiedUntil && <p className="panel">{t('hm_checkedNote')} {day(h.verifiedUntil)}. <Link href="/verified">{t('hm_whatMeans')}</Link></p>}
      <p className="panel msg">{t('hm_contactLater')}</p>
    </>
  );
}
