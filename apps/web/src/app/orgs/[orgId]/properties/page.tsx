'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useI18n } from '@/components/I18n';
import { api } from '@/lib/client';
import { readPosition } from '@/lib/position';

export default function Properties() {
  const { t } = useI18n();
  const { orgId } = useParams<{ orgId: string }>();
  const [items, setItems] = useState<any[] | null>(null), [nodes, setNodes] = useState<any[]>([]), [denied, setDenied] = useState(false), [canWrite, setCanWrite] = useState(false);
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
      <p><Link href={`/orgs/${orgId}`}>← {t('backToOrg')}</Link></p>
      <h1>{t('properties')}</h1>
      {canWrite && <p><Link href={`/orgs/${orgId}/properties/import`}>{t('importLink')} →</Link></p>}
      {items === null ? <p className="msg">{t('loading')}</p> : items.length === 0 ? <p className="msg">{t('noProperties')}</p> :
        items.map((p) => (
          <div className="card" key={p.id}>
            <Link href={`/orgs/${orgId}/properties/${p.id}`}><strong>{p.name}</strong></Link>
            <div className="msg">{p.addressText}{p.nodeName ? ` · ${p.nodeName}` : ''} · {p.unitCount} {p.unitCount === 1 ? t('unitOne') : t('unitCount')}</div>
          </div>
        ))}
      {canWrite && (
        <>
          <h2>{t('addProperty')}</h2>
          <form onSubmit={create}>
            <label htmlFor="pn">{t('propertyName')}</label>
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
