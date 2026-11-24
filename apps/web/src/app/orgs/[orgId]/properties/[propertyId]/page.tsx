'use client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Fragment, FormEvent, useCallback, useEffect, useState } from 'react';
import FilePanel from '@/components/FilePanel';
import ListingPanel, { statusClass, statusKey } from '@/components/ListingPanel';
import { useI18n } from '@/components/I18n';
import Loading from '@/components/Loading';
import PageHead from '@/components/PageHead';
import VerificationCard from '@/components/VerificationCard';
import T2Card from '@/components/T2Card';
import { api } from '@/lib/client';
import { readPosition } from '@/lib/position';

export default function PropertyPage() {
  const { t } = useI18n(); const router = useRouter();
  const { orgId, propertyId } = useParams<{ orgId: string; propertyId: string }>();
  const base = `orgs/${orgId}/properties/${propertyId}`;
  const [p, setP] = useState<any>(null), [units, setUnits] = useState<any[]>([]), [nodes, setNodes] = useState<any[]>([]), [denied, setDenied] = useState(false);
  const [canWrite, setCanWrite] = useState(false), [canArchive, setCanArchive] = useState(false);
  const [name, setName] = useState(''), [address, setAddress] = useState(''), [nodeId, setNodeId] = useState(''), [lat, setLat] = useState(''), [lon, setLon] = useState('');
  const [label, setLabel] = useState(''), [beds, setBeds] = useState('1'), [floor, setFloor] = useState(''), [editFloor, setEditFloor] = useState('');
  const [editing, setEditing] = useState<string | null>(null), [editLabel, setEditLabel] = useState(''), [editBeds, setEditBeds] = useState('');
  const [note, setNote] = useState(''), [error, setError] = useState(''), [mediaFor, setMediaFor] = useState<string | null>(null);
  const [listings, setListings] = useState<any[]>([]), [listingFor, setListingFor] = useState<string | null>(null);
  // The listing that matters for a unit: its open one, otherwise the most recent (the API returns newest first).
  const listingOf = (unitId: string) => { const mine = listings.filter((l) => l.unitId === unitId); return mine.find((l) => ['draft', 'published', 'stale'].includes(l.status)) ?? mine[0] ?? null; };

  const load = useCallback(async () => {
    const r = await api(base);
    if (r.status === 403 || r.status === 404) { setDenied(true); return; }
    const d = r.data; setP(d); setName(d.name); setAddress(d.addressText); setNodeId(d.nodeId ? String(d.nodeId) : ''); setLat(d.latitude ?? '' + ''); setLon(d.longitude ?? '' + '');
    if (d.latitude === null) { setLat(''); setLon(''); } else { setLat(String(d.latitude)); setLon(String(d.longitude)); }
    setUnits((await api(`${base}/units`)).data ?? []);
    setListings((await api(`orgs/${orgId}/listings?propertyId=${propertyId}`)).data ?? []);
    setNodes((await api('nodes')).data ?? []);
    const me = await api('me'); const roles: string[] = (me.data?.memberships ?? []).filter((m: any) => m.orgId === orgId).map((m: any) => m.role);
    setCanWrite(roles.length > 0); setCanArchive(roles.some((x) => x === 'manager_admin' || x === 'landlord'));
  }, [base, orgId, propertyId]);
  useEffect(() => { load(); }, [load]);

  async function save(e: FormEvent) {
    e.preventDefault(); setError(''); setNote('');
    const pos = readPosition(lat, lon);
    if (!pos.ok) { setError(t(pos.error)); return; }
    const body: any = { name, addressText: address, nodeId: nodeId ? Number(nodeId) : null, ...(pos.value ?? { latitude: null, longitude: null }) };
    const r = await api(base, { method: 'PATCH', body });
    if (r.status === 200) { setNote(t('saved')); load(); } else setError(r.status === 409 ? t('duplicateProperty') : r.status === 400 ? String(r.data?.message ?? t('genericError')) : t('genericError'));
  }
  async function archiveProperty() {
    if (!window.confirm(t('archiveConfirm'))) return;
    const r = await api(`${base}/archive`, { method: 'POST' });
    if (r.status === 204) router.replace(`/orgs/${orgId}/properties`); else setError(t('genericError'));
  }
  async function addUnit(e: FormEvent) {
    e.preventDefault(); setError(''); setNote('');
    if (!Number.isInteger(Number(beds))) { setError(t('numbersOnly')); return; }
    const r = await api(`${base}/units`, { method: 'POST', body: { label, bedrooms: Number(beds), floor: floor || null } });
    if (r.status === 201) { setLabel(''); setFloor(''); load(); } else setError(r.status === 409 ? t('duplicateUnit') : r.status === 400 ? String(r.data?.message ?? t('genericError')) : t('genericError'));
  }
  async function saveUnit(id: string) {
    setError('');
    if (!Number.isInteger(Number(editBeds))) { setError(t('numbersOnly')); return; }
    const r = await api(`${base}/units/${id}`, { method: 'PATCH', body: { label: editLabel, bedrooms: Number(editBeds), floor: editFloor || null } });
    if (r.status === 200) { setEditing(null); load(); } else setError(r.status === 409 ? t('duplicateUnit') : r.status === 400 ? String(r.data?.message ?? t('genericError')) : t('genericError'));
  }
  async function archiveUnit(id: string) {
    if (!window.confirm(t('archiveConfirm'))) return;
    const r = await api(`${base}/units/${id}/archive`, { method: 'POST' });
    if (r.status === 204) load(); else setError(t('genericError'));
  }

  if (denied) return <p className="error">{t('noAccess')}</p>;
  if (!p) return <Loading />;
  return (
    <>
      <PageHead back={{ href: `/orgs/${orgId}/properties`, label: t('properties') }} eyebrow={p.nodeName ?? undefined} title={p.name}><span className="badge">{units.length} {units.length === 1 ? t('unitOne') : t('unitCount')}</span></PageHead>
      <VerificationCard orgId={orgId} propertyId={propertyId} canWrite={canWrite} />
      <T2Card orgId={orgId} propertyId={propertyId} canWrite={canWrite} />

      {canWrite ? (
        <form onSubmit={save} className="panel">
          <label htmlFor="n">{t('propertyName')}</label><input id="n" value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={120} required />
          <label htmlFor="a">{t('address')}</label><input id="a" value={address} onChange={(e) => setAddress(e.target.value)} minLength={3} maxLength={300} required />
          <label htmlFor="z">{t('node')}</label>
          <select id="z" value={nodeId} onChange={(e) => setNodeId(e.target.value)}>
            <option value="">{t('noNode')}</option>{nodes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
          </select>
          <label htmlFor="la">{t('latitude')}</label><input id="la" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} />
          <label htmlFor="lo">{t('longitude')}</label><input id="lo" inputMode="decimal" value={lon} onChange={(e) => setLon(e.target.value)} />
          <p className="msg">{t('positionHint')}</p>
          <div className="row"><button>{t('save')}</button>{canArchive && <button type="button" className="danger" onClick={archiveProperty}>{t('archive')}</button>}</div>
        </form>
      ) : <p className="panel msg">{p.addressText}</p>}

      <h2>{t('files')}</h2>
      <FilePanel orgId={orgId} propertyId={propertyId} kinds={['document', 'photo', 'video']} canWrite={canWrite} canArchive={canArchive} />

      <h2>{t('units')}</h2>
      {units.length === 0 ? <div className="empty">{t('noUnits')}</div> : (
        <table className="table">
          <thead><tr><th>{t('unitLabel')}</th><th>{t('floor')}</th><th>{t('bedrooms')}</th><th>{t('ls_listing')}</th><th /></tr></thead>
          <tbody>
            {units.map((u) => (
              <Fragment key={u.id}>
                <tr>
                  {editing === u.id ? (
                    <>
                      <td><input aria-label={t('unitLabel')} value={editLabel} onChange={(e) => setEditLabel(e.target.value)} maxLength={40} /></td>
                      <td><input aria-label={t('floor')} value={editFloor} onChange={(e) => setEditFloor(e.target.value)} maxLength={20} /></td>
                      <td><input aria-label={t('bedrooms')} inputMode="numeric" value={editBeds} onChange={(e) => setEditBeds(e.target.value)} /></td><td />
                      <td className="actions"><button type="button" onClick={() => saveUnit(u.id)}>{t('save')}</button><button type="button" className="link" onClick={() => setEditing(null)}>{t('cancel')}</button></td>
                    </>
                  ) : (
                    <>
                      <td><strong>{u.label}</strong></td><td>{u.floor ?? '–'}</td><td>{u.bedrooms === 0 ? t('bedsitter') : u.bedrooms}</td>
                      <td>{(() => { const l = listingOf(u.id); return l ? <span className={`vstate ${statusClass(l.status, l.phase)}`}>{t(statusKey(l) as any)}</span> : <span className="msg">{t('ls_notListed')}</span>; })()}</td>
                      <td className="actions">
                        <button type="button" className="link" onClick={() => setListingFor(listingFor === u.id ? null : u.id)}>{t('ls_listing')}</button>
                        <button type="button" className="link" onClick={() => setMediaFor(mediaFor === u.id ? null : u.id)}>{t('mediaToggle')}</button>
                        {canWrite && <button type="button" className="link" onClick={() => { setEditing(u.id); setEditLabel(u.label); setEditBeds(String(u.bedrooms)); setEditFloor(u.floor ?? ''); }}>{t('edit')}</button>}
                        {canArchive && <button type="button" className="link" onClick={() => archiveUnit(u.id)}>{t('archive')}</button>}
                      </td>
                    </>
                  )}
                </tr>
                {listingFor === u.id && <tr><td colSpan={5}><ListingPanel orgId={orgId} propertyId={propertyId} unitId={u.id} listing={listingOf(u.id)} canWrite={canWrite} onChange={load} /></td></tr>}
                {mediaFor === u.id && <tr><td colSpan={5}><FilePanel orgId={orgId} propertyId={propertyId} unitId={u.id} kinds={['photo', 'video']} canWrite={canWrite} canArchive={canArchive} /></td></tr>}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
      {canWrite && (
        <form onSubmit={addUnit} className="panel">
          <h2>{t('addUnit')}</h2>
          <label htmlFor="ul">{t('unitLabel')}</label><input id="ul" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} required />
          <label htmlFor="uf">{t('floor')} ({t('optional')})</label><input id="uf" value={floor} onChange={(e) => setFloor(e.target.value)} maxLength={20} />
          <label htmlFor="ub">{t('bedrooms')}</label><input id="ub" inputMode="numeric" value={beds} onChange={(e) => setBeds(e.target.value)} required />
          <p className="msg">{t('bedsitterHint')}</p>
          <button>{t('addUnit')}</button>
        </form>
      )}
      {note && <p className="msg" role="status">{note}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </>
  );
}
