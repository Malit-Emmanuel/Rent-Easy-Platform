'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useI18n } from '@/components/I18n';
import Loading from '@/components/Loading';
import EmptyState from '@/components/EmptyState';
import PropertyCard, { cardState } from '@/components/PropertyCard';
import { api } from '@/lib/client';
import { readPosition } from '@/lib/position';

export default function Properties() {
  const { t } = useI18n();
  const { orgId } = useParams<{ orgId: string }>();
  const [items, setItems] = useState<any[] | null>(null), [nodes, setNodes] = useState<any[]>([]), [denied, setDenied] = useState(false), [canWrite, setCanWrite] = useState(false);
  const [q, setQ] = useState(''), [area, setArea] = useState('');
  const [name, setName] = useState(''), [address, setAddress] = useState(''), [nodeId, setNodeId] = useState(''), [lat, setLat] = useState(''), [lon, setLon] = useState(''), [error, setError] = useState('');

  const load = useCallback(async () => {
    const r = await api(`orgs/${orgId}/properties`);
    if (r.status === 403) { setDenied(true); return; }
    setItems(r.data ?? []);
    const me = await api('me');
    setCanWrite(!!me.data?.memberships?.some((m: any) => m.orgId === orgId));
    setNodes((await api('nodes')).data ?? []);
  }, [orgId]);
  useEffect(() => { load(); }, [load]);

  async function create(e: FormEvent) {
    e.preventDefault(); setError('');
    const pos = readPosition(lat, lon);
    if (!pos.ok) { setError(t(pos.error)); return; }
    const body: any = { name, addressText: address };
    if (nodeId) body.nodeId = Number(nodeId);
    if (pos.value) Object.assign(body, pos.value);
    const r = await api(`orgs/${orgId}/properties`, { method: 'POST', body });
    if (r.status === 201) { setName(''); setAddress(''); setNodeId(''); setLat(''); setLon(''); load(); }
    else setError(r.status === 409 ? t('duplicateProperty') : r.status === 400 ? String(r.data?.message ?? t('genericError')) : t('genericError'));
  }

  if (denied) return <p className="error">{t('noAccess')}</p>;
  return (
    <>
      <p className="eyebrow">{t('overview')}</p>
      <h1>{t('properties')}</h1>
      <div className="toolbar">
        <input aria-label={t('search')} placeholder={t('search')} value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label={t('allAreas')} value={area} onChange={(e) => setArea(e.target.value)}>
          <option value="">{t('allAreas')}</option>
          {[...new Set((items ?? []).map((p) => p.nodeName).filter(Boolean))].sort().map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <span className="spacer" />
        <Link className="link" href={`/orgs/${orgId}/listings`}>{t('ls_listings')}</Link>
        {canWrite && <Link className="btn" href={`/orgs/${orgId}/properties/import`}>{t('importLink')}</Link>}
      </div>
      {items === null ? <Loading /> : items.length === 0 ? <EmptyState title={t('emptyPropsTitle')}>{t('emptyPropsBody')}</EmptyState> : (() => {
        const shown = items.filter((p) => (!area || p.nodeName === area) && (`${p.name} ${p.addressText}`.toLowerCase().includes(q.trim().toLowerCase())));
        return shown.length === 0 ? <div className="empty">{t('noMatches')}</div> :
          <div className="grid">{shown.map((p) => <PropertyCard key={p.id} orgId={orgId} p={p} units={t('unitCount')} one={t('unitOne')} tag={p.nodeName ?? undefined} state={cardState(p, t)} />)}</div>;
      })()}
      {canWrite && (
        <>
          <h2>{t('addProperty')}</h2>
          <form onSubmit={create} className="panel">
            <label htmlFor="pn" style={{ marginTop: 0 }}>{t('propertyName')}</label>
            <input id="pn" value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={120} required />
            <label htmlFor="pa">{t('address')}</label>
            <input id="pa" value={address} onChange={(e) => setAddress(e.target.value)} minLength={3} maxLength={300} required />
            <label htmlFor="pz">{t('node')}</label>
            <select id="pz" value={nodeId} onChange={(e) => setNodeId(e.target.value)}>
              <option value="">{t('noNode')}</option>
              {nodes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
            </select>
            <label htmlFor="pla">{t('latitude')}</label>
            <input id="pla" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} />
            <label htmlFor="plo">{t('longitude')}</label>
            <input id="plo" inputMode="decimal" value={lon} onChange={(e) => setLon(e.target.value)} />
            <p className="msg">{t('positionHint')}</p>
            <button>{t('addProperty')}</button>
            {error && <p className="error" role="alert">{error}</p>}
          </form>
        </>
      )}
    </>
  );
}
