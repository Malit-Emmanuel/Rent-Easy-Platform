"use client";
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useI18n } from '@/components/I18n';
import { monthOptions } from '@/lib/oversight';

/** Sub-navigation for the oversight area (admins only). */
export function OversightTabs() {
  const { t } = useI18n(); const path = usePathname();
  const tabs = [{ href: '/oversight', label: t('ovTabOverview') }, { href: '/oversight/cost', label: t('ovTabCost') }, { href: '/oversight/reviewers', label: t('ovTabReviewers') }, { href: '/oversight/alerts', label: t('ovTabAlerts') }, { href: '/oversight/privacy', label: t('drTabRequests') }];
  return (
    <nav className="tabs" aria-label={t('ovTitle')}>
      {tabs.map((x) => <Link key={x.href} href={x.href} aria-current={path === x.href ? 'page' : undefined} className={path === x.href ? 'on' : ''}>{x.label}</Link>)}
    </nav>
  );
}

/** Pick the month a report is about. Newest first; the reports start in January 2024. */
export function MonthPicker({ month, onChange, id = 'month' }: { month: string; onChange: (m: string) => void; id?: string }) {
  const { t } = useI18n();
  const opts = monthOptions(); if (!opts.includes(month)) opts.push(month);
  return (
    <div className="toolbar">
      <label htmlFor={id}>{t('ovMonth')}</label>
      <select id={id} value={month} onChange={(e) => onChange(e.target.value)}>{opts.map((m) => <option key={m} value={m}>{m}</option>)}</select>
    </div>
  );
}
