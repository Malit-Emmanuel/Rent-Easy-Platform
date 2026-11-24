'use client';
import { FormEvent, useEffect, useState } from 'react';
import { useI18n } from '@/components/I18n';
import { api } from '@/lib/client';

const FIELDS = ['rent', 'deposit', 'utilityDeposit', 'serviceCharge', 'agentFee'] as const;
export const STATUS_KEY: Record<string, string> = { draft: 'ls_stDraft', published: 'ls_stPublished', stale: 'ls_stStale', let: 'ls_stLet', withdrawn: 'ls_stWithdrawn' };
/** A published listing that has gone 14 days without a confirmation is shown as "Confirm soon" until it is confirmed or hidden at 21 days. */
export const statusKey = (l: { status: string; phase?: string | null }) => (l.status === 'published' && l.phase === 'remind' ? 'ls_stRemind' : STATUS_KEY[l.status]);
export const statusClass = (s: string, phase?: string | null) => (s === 'published' && phase === 'remind' ? 'wait' : s === 'published' ? 'ok' : s === 'stale' ? 'wait' : s === 'withdrawn' ? 'bad' : '');
const kes = (n: number | null) => (n === null || n === undefined ? '–' : `KES ${n.toLocaleString('en-KE')}`);
const day = (d: string | null) => (d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '–');

/** Everything a manager does with one unit's listing: start, enter the five costs, publish, confirm, mark let, withdraw. */
export default function ListingPanel({ orgId, propertyId, unitId, listing, canWrite, onChange }: { orgId: string; propertyId: string; unitId: string; listing: any | null; canWrite: boolean; onChange: () => void }) {
  const { t } = useI18n();
  const [vals, setVals] = useState<Record<string, string>>({}), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { const v: Record<string, string> = {}; for (const f of FIELDS) v[f] = listing?.costs?.[f] === null || listing?.costs?.[f] === undefined ? '' : String(listing.costs[f]); setVals(v); }, [listing]);

  const fail = (r: any) => setError(r.status === 400 || r.status === 409 ? String(r.data?.message ?? t('genericError')) : t('genericError'));
  async function post(path: string, method = 'POST', body?: unknown) {
    setError(''); setBusy(true);
    const r = await api(path, { method, body }); setBusy(false);
    if (r.status >= 200 && r.status < 300) { onChange(); return true; } fail(r); return false;
  }
  const start = () => post(`orgs/${orgId}/properties/${propertyId}/units/${unitId}/listings`);
  async function saveCosts(e?: FormEvent) {
    e?.preventDefault();
    const body: Record<string, number> = {};
    for (const f of FIELDS) { if (vals[f] === '') continue; const n = Number(vals[f].replace(/,/g, '')); if (!Number.isInteger(n)) { setError(t('ls_amountsOnly')); return false; } body[f] = n; }
    return post(`orgs/${orgId}/listings/${listing.id}/costs`, 'PUT', body);
  }
  async function publish() {
    if (FIELDS.some((f) => vals[f] === '')) { setError(t('ls_missingCosts')); return; }
    if (!(await saveCosts())) return;
    await post(`orgs/${orgId}/listings/${listing.id}/publish`);
  }
  const confirm = () => post(`orgs/${orgId}/listings/${listing.id}/confirm`);
  const act = (a: 'let' | 'withdraw', q: string) => { if (window.confirm(t(q))) post(`orgs/${orgId}/listings/${listing.id}/${a}`); };

  const open = listing && ['draft', 'published', 'stale'].includes(listing.status);
  if (!open) {
    return (
      <div className="panel" aria-label={t('ls_listing')}>
        {listing && <p className="msg"><span className={`vstate ${statusClass(listing.status)}`}>{t(statusKey(listing) as any)}</span></p>}
        {canWrite ? <button type="button" onClick={start} disabled={busy}>{t('ls_start')}</button> : <p className="msg">{t('ls_notListed')}</p>}
        {error && <p className="error" role="alert">{error}</p>}
      </div>
    );
  }
  return (
    <form className="panel" onSubmit={saveCosts} aria-label={t('ls_listing')}>
      <p><span className={`vstate ${statusClass(listing.status, listing.phase)}`}>{t(statusKey(listing) as any)}</span></p>
      {listing.status !== 'draft' && (
        <p className="msg">{t('ls_confirmedOn')}: {day(listing.lastConfirmedAt)} · {t('ls_remindBy')} {day(listing.remindAt)} · {t('ls_hiddenOn')} {day(listing.hideAt)}</p>
      )}
      {listing.status === 'stale' && <p className="error" role="status">{t('ls_staleNote')}</p>}
      {listing.status === 'published' && listing.phase === 'remind' && (
        <p className="msg" role="status"><strong>{t('ls_remindNote')}</strong></p>
      )}
      <p className="msg">{t('ls_costsIntro')}</p>
      {FIELDS.map((f) => (
        <div key={f}>
          <label htmlFor={`${unitId}-${f}`}>{t(`ls_${f}` as any)} (KES)</label>
          <input id={`${unitId}-${f}`} inputMode="numeric" value={vals[f] ?? ''} disabled={!canWrite} onChange={(e) => setVals({ ...vals, [f]: e.target.value })} />
        </div>
      ))}
      <p><strong>{t('ls_total')}:</strong> {kes(listing.totalMoveIn)}</p>
      <p className="msg">{t('ls_note')}</p>
      {canWrite && (
        <div className="row">
          <button disabled={busy}>{t('ls_saveCosts')}</button>
          {listing.status === 'draft' && <button type="button" disabled={busy} onClick={publish}>{t('ls_publish')}</button>}
          {listing.status !== 'draft' && <button type="button" disabled={busy} onClick={confirm}>{t('ls_confirm')}</button>}
          {listing.status !== 'draft' && <button type="button" className="link" disabled={busy} onClick={() => act('let', 'ls_letConfirm')}>{t('ls_let')}</button>}
          <button type="button" className="link" disabled={busy} onClick={() => act('withdraw', 'ls_withdrawConfirm')}>{t('ls_withdraw')}</button>
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  );
}
