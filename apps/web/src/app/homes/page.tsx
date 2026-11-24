'use client';
import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '@/components/I18n';
import EmptyState from '@/components/EmptyState';
import HomeCard from '@/components/HomeCard';
import Loading from '@/components/Loading';

/** Public search for rentals. Open to anyone, no sign-in, nothing stored about the visitor. Closed (a plain message) until the platform switch is turned on. */
export default function Homes() {
  const { t } = useI18n();
  const [areas, setAreas] = useState<any[]>([]), [items, setItems] = useState<any[] | null>(null), [more, setMore] = useState(false), [state, setState] = useState<'ok' | 'closed' | 'busy' | 'error'>('ok');
  const [node, setNode] = useState(''), [beds, setBeds] = useState(''), [maxRent, setMaxRent] = useState(''), [verified, setVerified] = useState(false), [sort, setSort] = useState('new');

  const query = useCallback((offset: number) => {
    const p = new URLSearchParams({ limit: '20', offset: String(offset), sort });
    if (node) p.set('node', node); if (beds) p.set('bedrooms', beds); if (/^\d+$/.test(maxRent.trim())) p.set('maxRent', maxRent.trim()); if (verified) p.set('verified', '1');
    return p.toString();
  }, [node, beds, maxRent, verified, sort]);

  const run = useCallback(async (offset: number) => {
    const r = await fetch(`/api/public/listings?${query(offset)}`, { cache: 'no-store' }).catch(() => null);
    if (!r) { setState('error'); return; }
    if (r.status === 404) { setState('closed'); return; }
    if (r.status === 429) { setState('busy'); return; }
    if (!r.ok) { setState('error'); return; }
    const d = await r.json(); setState('ok'); setMore(!!d.hasMore); setItems((prev) => (offset === 0 ? d.items : [...(prev ?? []), ...d.items]));
  }, [query]);

  useEffect(() => { fetch('/api/public/areas', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : [])).then(setAreas).catch(() => {}); }, []);
  useEffect(() => { setItems(null); run(0); }, [run]);

  if (state === 'closed') return <EmptyState title={t('hm_closedTitle')}>{t('hm_closedBody')}</EmptyState>;
  return (
    <>
      <h1>{t('hm_title')}</h1>
      <p className="msg">{t('hm_intro')}</p>
      <div className="toolbar" role="search">
        <select aria-label={t('node')} value={node} onChange={(e) => setNode(e.target.value)}>
          <option value="">{t('allAreas')}</option>{areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select aria-label={t('bedrooms')} value={beds} onChange={(e) => setBeds(e.target.value)}>
          <option value="">{t('hm_anyBeds')}</option><option value="0">{t('bedsitter')}</option>{[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n} {t('hm_bed')}</option>)}
        </select>
        <input aria-label={t('hm_maxRent')} placeholder={t('hm_maxRent')} inputMode="numeric" value={maxRent} onChange={(e) => setMaxRent(e.target.value)} />
        <label className="chk"><input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} /> {t('hm_onlyChecked')}</label>
        <select aria-label={t('hm_sort')} value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="new">{t('hm_sortNew')}</option><option value="cost">{t('hm_sortCost')}</option>
        </select>
      </div>
      {state === 'busy' && <p className="error" role="alert">{t('hm_busy')}</p>}
      {state === 'error' && <p className="error" role="alert">{t('genericError')}</p>}
      {items === null && state === 'ok' ? <Loading cards /> : items && items.length === 0 ? <EmptyState title={t('hm_noneTitle')}>{t('hm_noneBody')}</EmptyState> : (
        <div className="grid">{(items ?? []).map((h) => <HomeCard key={h.id} h={h} />)}</div>
      )}
      {more && <p><button type="button" onClick={() => run(items?.length ?? 0)}>{t('hm_more')}</button></p>}
      <p className="msg">{t('hm_footnote')}</p>
    </>
  );
}
