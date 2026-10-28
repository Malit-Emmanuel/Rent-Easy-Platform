'use client';
import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useI18n } from '@/components/I18n';
import PropertyCard, { PropertyRow } from '@/components/PropertyCard';
import { api } from '@/lib/client';

interface OrgRow { id: string; name: string; kind: string; roles: string[]; props: PropertyRow[] }

export default function Home() {
  const { t } = useI18n();
  const [orgs, setOrgs] = useState<OrgRow[] | null>(null);
  const [name, setName] = useState(''), [kind, setKind] = useState('management_firm'), [error, setError] = useState('');
  const [verified, setVerified] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    const me = await api('me');
    if (me.status !== 200) return;
    const byOrg = new Map<string, string[]>();
    for (const m of me.data.memberships) byOrg.set(m.orgId, [...(byOrg.get(m.orgId) ?? []), m.role]);
    const rows = await Promise.all([...byOrg].map(async ([id, roles]) => {
      const o = await api(`orgs/${id}`);
      const pr = await api(`orgs/${id}/properties`);
      return { id, roles, name: o.data?.name ?? id, kind: o.data?.kind ?? '', props: (pr.status === 200 ? pr.data : []) as PropertyRow[] };
    }));
    setOrgs(rows);
    setVerified((await api('me/verification')).data?.verified ?? false);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function create(e: FormEvent) {
    e.preventDefault(); setError('');
    const r = await api('orgs', { method: 'POST', body: { name, kind } });
    if (r.status === 201) { setName(''); load(); } else setError(t('genericError'));
  }
  const props = (orgs ?? []).reduce((n, o) => n + o.props.length, 0), units = (orgs ?? []).reduce((n, o) => n + o.props.reduce((m, p) => m + p.unitCount, 0), 0);
  return (
    <>
      <p className="eyebrow">{t('overview')}</p>
      <h1>{t('home')}</h1>
      <div className="stats">
        <div className="stat"><b>{orgs === null ? '–' : orgs.length}</b><span>{t('yourOrgs')}</span></div>
        <div className="stat"><b>{orgs === null ? '–' : props}</b><span>{t('totalProperties')}</span></div>
        <div className="stat"><b>{orgs === null ? '–' : units}</b><span>{t('totalUnits')}</span></div>
        <div className="stat"><b style={{ fontSize: '1.1rem' }}>{verified === null ? t('loading') : verified ? t('verified') : t('notVerified')}</b><span><Link href="/verification">{t('verification')}</Link></span></div>
      </div>
      {orgs && orgs.length > 0 && props === 0 && (
        <div className="card"><p className="eyebrow">{t('nextStep')}</p><strong>{t('nextImport')}</strong><p className="msg">{t('nextImportHint')}</p>
          <Link className="btn" href={`/orgs/${orgs[0].id}/properties/import`}>{t('importLink')}</Link></div>
      )}
      {orgs === null ? <p className="msg">{t('loading')}</p> : orgs.length === 0 ? <div className="empty">{t('noOrgs')}</div> :
        orgs.map((o) => (
          <section key={o.id}>
            <div className="row"><h2 style={{ margin: '28px 0 4px' }}>{o.name}</h2><span className="spacer" /><Link href={`/orgs/${o.id}/properties`}>{t('propertiesLink')} →</Link></div>
            <div className="msg" style={{ marginBottom: 12 }}>{t('kind_' + o.kind)} · {o.roles.map((r) => t('role_' + r)).join(', ')}</div>
            {o.props.length > 0 && <div className="hscroll">{o.props.slice(0, 8).map((p) => <PropertyCard key={p.id} orgId={o.id} p={p} units={t('unitCount')} one={t('unitOne')} tag={p.nodeName ?? undefined} />)}</div>}
          </section>
        ))}
      <h2>{t('createOrg')}</h2>
      <form onSubmit={create}>
        <label htmlFor="org">{t('orgName')}</label>
        <input id="org" value={name} onChange={(e) => setName(e.target.value)} minLength={2} required />
        <label htmlFor="kind">{t('orgKind')}</label>
        <select id="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
          {['agency', 'management_firm', 'landlord'].map((k) => <option key={k} value={k}>{t('kind_' + k)}</option>)}
        </select>
        <button>{t('create')}</button>
        {error && <p className="error" role="alert">{error}</p>}
      </form>
    </>
  );
}
