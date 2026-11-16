'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useI18n } from './I18n';
import { SITE_LABELS } from '@/lib/site';
import { api } from '@/lib/client';
import PolicyBanner from './PolicyBanner';
import Logo from './Logo';

/** The whole app frame: side menu on wide screens, bottom bar on phones. The sign-in page gets a plain frame. */
export default function Shell({ children }: { children: React.ReactNode }) {
  const { t, lang } = useI18n();
  const path = usePathname(), router = useRouter();
  const [reviewer, setReviewer] = useState(false), [oversight, setOversight] = useState(false);
  const isSite = ['/welcome', '/verified', '/privacy', '/terms'].includes(path);   // public pages: their own frame, no API calls
  const signedIn = path !== '/login' && !isSite;
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
    { href: '/account', label: t('drNav'), icon: '◐', on: path.startsWith('/account') },
  ];
  const langPick = (
    <label className="lang">{t('language')}{' '}
      <select value={lang} onChange={(e) => setLang(e.target.value)} aria-label={t('language')}>
        <option value="en">English</option><option value="sw">Kiswahili</option>
      </select>
    </label>
  );
  if (isSite) {
    const L = SITE_LABELS[lang];
    return (
      <div className="site">
        <header className="sitebar"><Link href="/" className="brand"><Logo />Zuri Home</Link><span className="spacer" />{langPick}<Link className="btn small" href="/login">{t('signIn')}</Link></header>
        <div className="sitemain">{children}</div>
        <footer className="sitefoot"><span>Zuri Home · {L.footer}</span><nav aria-label="Legal"><Link href="/verified">{L.verified}</Link><Link href="/privacy">{L.privacy}</Link><Link href="/terms">{L.terms}</Link></nav></footer>
      </div>
    );
  }
  if (!signedIn) return <div className="plain"><div className="brand"><Logo /><span>Zuri Home<small>{t('appTagline')}</small></span></div>{children}<p style={{ textAlign: 'center' }}>{langPick}</p></div>;
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand"><Logo /><span>Zuri Home<small>{t('appTagline')}</small></span></div>
        <nav className="nav" aria-label="Main">
          {items.map((i) => <Link key={i.href} href={i.href} aria-current={i.on ? 'page' : undefined}><span className="ic" aria-hidden>{i.icon}</span>{i.label}</Link>)}
        </nav>
        <div className="foot">{langPick}<button className="link" onClick={signOut}>{t('signOut')}</button></div>
      </aside>
      <div className="content">
        <div className="topbar"><span className="brand"><Logo />Zuri Home</span><span className="spacer" />{langPick}<button className="link" onClick={signOut}>{t('signOut')}</button></div>
        <PolicyBanner />
        <main>{children}</main>
      </div>
    </div>
  );
}
