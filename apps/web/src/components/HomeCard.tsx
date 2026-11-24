'use client';
import Link from 'next/link';
import { useI18n } from '@/components/I18n';

export const kes = (n: number) => `KES ${n.toLocaleString('en-KE')}`;
export const day = (d: string) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** One result in the public search. Shows the rent and the total to move in side by side: the second number is the one people need. */
export default function HomeCard({ h }: { h: any }) {
  const { t } = useI18n();
  return (
    <Link className="homecard" href={`/homes/${h.id}`}>
      <div className="row"><strong>{h.propertyName}</strong><span className="spacer" />{h.verifiedUntil && <span className="vstate ok">{t('hm_checked')}</span>}</div>
      <p className="msg">{h.area ?? t('hm_noArea')} · {h.bedrooms === 0 ? t('bedsitter') : `${h.bedrooms} ${t('hm_bed')}`}</p>
      <p className="hm-rent">{kes(h.costs.rent)} <small>{t('hm_perMonth')}</small></p>
      <p className="hm-total">{t('hm_totalToMove')}: <strong>{kes(h.totalMoveIn)}</strong></p>
      <p className="msg">{t('hm_confirmedOn')} {day(h.confirmedAt)}</p>
    </Link>
  );
}
