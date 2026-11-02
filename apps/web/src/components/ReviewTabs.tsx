"use client";
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useI18n } from '@/components/I18n';

/** Sub-navigation for the reviewer area. */
export default function ReviewTabs() {
  const { t } = useI18n(); const path = usePathname();
  const tabs = [{ href: '/review', label: t('rvTabQueue') }, { href: '/review/verified', label: t('rvBadges') }, { href: '/review/history', label: t('rvTabHistory') }];
  return (
    <nav className="tabs" aria-label={t('rvTitle')}>
      {tabs.map((x) => <Link key={x.href} href={x.href} aria-current={path === x.href ? 'page' : undefined} className={path === x.href ? 'on' : ''}>{x.label}</Link>)}
    </nav>
  );
}
