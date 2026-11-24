'use client';
import { useI18n } from '@/components/I18n';

/** Grey placeholder bars shown while a page loads. Screen readers hear "Loading…". */
export default function Loading({ rows = 3, cards = false }: { rows?: number; cards?: boolean }) {
  const { t } = useI18n();
  return (
    <div className={cards ? 'skel-wrap cards' : 'skel-wrap'} role="status" aria-busy="true">
      <span className="sr-only">{t('loading')}</span>
      {Array.from({ length: rows }, (_, i) => <div key={i} className={cards ? 'skel skel-card' : 'skel skel-line'} aria-hidden="true" style={cards ? undefined : { width: `${92 - (i % 3) * 14}%` }} />)}
    </div>
  );
}

/** A small placeholder that stands in for a number while it loads. */
export function SkelNumber() { return <span className="skel skel-num" aria-hidden="true" />; }
