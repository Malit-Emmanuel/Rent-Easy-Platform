'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useI18n } from './I18n';
import { api } from '@/lib/client';

/** The whole app frame: side menu on wide screens, bottom bar on phones. The sign-in page gets a plain frame. */
export default function Shell({ children }: { children: React.ReactNode }) {
  const { t, lang } = useI18n();
  const path = usePathname(), router = useRouter();
  const [reviewer, setReviewer] = useState(false), [oversight, setOversight] = useState(false);
  const signedIn = path !== '/login';
  useEffect(() => { if (signedIn) { api('admin/verifications/queue').then((r) => setReviewer(r.status === 200)); api('admin/review/access').then((r) => setOversight(r.status === 200)); } }, [signedIn]);

  const setLang = (l: string) => { document.cookie = `lang=${l}; path=/; max-age=31536000; samesite=lax`; router.refresh(); };
  const signOut = async () => { await fetch('/api/auth/logout', { method: 'POST' }); window.location.href = '/login'; };
  const orgId = path.match(/^\/orgs\/([^/]+)/)?.[1];
  const items = [
    { href: '/', label: t('home'), icon: '⌂', on: path === '/' },
    ...(orgId ? [{ href: `/orgs/${orgId}/properties`, label: t('properties'), icon: '▦', on: path.startsWith(`/orgs/${orgId}/properties`) && !path.endsWith('/import') },
                 { href: `/orgs/${orgId}/properties/import`, label: t('importNav'), icon: '↥', on: path.endsWith('/import') },
                 { href: `/orgs/${orgId}`, label: t('members'), icon: '☺', on: path === `/orgs/${orgId}` }] : []),
    { href: '/verification', label: t('verification'), icon: '✓', on: path.startsWith('/verification') },
    ...(reviewer ? [{ href: '/review', label: t('rvNav'), icon: '▤', on: path.startsWith('/review') }] : []),
    ...(reviewer ? [{ href: '/admin', label: t('admin'), icon: '◎', on: path.startsWith('/admin') }] : []),
    ...(oversight ? [{ href: '/oversight', label: t('ovNav'), icon: '◔', on: path.startsWith('/oversight') }] : []),
  ];
  const langPick = (
    <label className="lang">{t('language')}{' '}
      <select value={lang} onChange={(e) => setLang(e.target.value)} aria-label={t('language')}>
        <option value="en">English</option><option value="sw">Kiswahili</option>
      </select>
    </label>
  );
  if (!signedIn) return <div className="plain"><div className="brand">Zuri Home</div>{children}<p style={{ textAlign: 'center' }}>{langPick}</p></div>;
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">Zuri Home<small>{t('appTagline')}</small></div>
        <nav className="nav" aria-label="Main">
          {items.map((i) => <Link key={i.href} href={i.href} aria-current={i.on ? 'page' : undefined}><span className="ic" aria-hidden>{i.icon}</span>{i.label}</Link>)}
        </nav>
        <div className="foot">{langPick}<button className="link" onClick={signOut}>{t('signOut')}</button></div>
      </aside>
      <div className="content">
        <div className="topbar"><span className="brand">Zuri Home</span><span className="spacer" />{langPick}<button className="link" onClick={signOut}>{t('signOut')}</button></div>
        <main>{children}</main>
      </div>
    </div>
  );
}
