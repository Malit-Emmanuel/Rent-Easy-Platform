'use client';
import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '@/components/I18n';
import Loading from '@/components/Loading';
import PageHead from '@/components/PageHead';
import { MonthPicker, OversightTabs } from '@/components/OversightTabs';
import { api } from '@/lib/client';
import { currentMonth, fmtKes, fmtNum, parseAmount } from '@/lib/oversight';

const KINDS = ['reviewer_rate_per_hour', 'identity_check_fees', 'field_visits', 'other'];

export default function OversightCost() {
  const { t } = useI18n();
  const [month, setMonth] = useState(currentMonth()), [rep, setRep] = useState<any>(null), [inputs, setInputs] = useState<any>(null), [denied, setDenied] = useState(false);
  const [tier, setTier] = useState('all'), [kind, setKind] = useState('reviewer_rate_per_hour'), [amount, setAmount] = useState(''), [note, setNote] = useState(''), [msg, setMsg] = useState(''), [err, setErr] = useState('');
  const load = useCallback(async () => {
    const [a, b] = await Promise.all([api(`admin/reports/cost?month=${month}`), api(`admin/cost-inputs?month=${month}`)]);
    if (a.status === 403 || b.status === 403) { setDenied(true); return; }
    setRep(a.data); setInputs(b.data);
  }, [month]);
  useEffect(() => { setRep(null); load(); }, [load]);
  async function add(e: React.FormEvent) {
    e.preventDefault(); setMsg(''); setErr('');
    const n = parseAmount(amount);
    if (n === null) { setErr(t('ovBadAmount')); return; }
    if (kind === 'other' && !note.trim()) { setErr(t('ovNoteNeeded')); return; }
    const r = await api('admin/cost-inputs', { method: 'POST', body: { period: month, tier, kind, amountKes: n, note: note.trim() || undefined } });
    if (r.status === 201) { setMsg(t('saved')); setAmount(''); setNote(''); load(); } else setErr(t('genericError'));
  }
  if (denied) return <p className="error">{t('noAccess')}</p>;
  const word = (k: string) => (t as any)(k) as string;
  return (
    <>
      <PageHead eyebrow={t('appName')} title={t('ovTitle')} />
      <OversightTabs />
      <p className="msg">{t('ovNotPay')}</p>
      <MonthPicker month={month} onChange={setMonth} />
      {rep === null ? <Loading /> : (
        <>
          <h2>{t('ovCostTitle')}</h2>
          <p className="msg">{t('ovTarget').replace('{n}', String(rep.targetKes))}</p>
          <div className="grid">
            {(['t1', 't2'] as const).map((tr) => { const x = rep.tiers[tr]; const row = (label: string, v: any) => (
              <tr key={label}><td>{label}</td><td><strong>{fmtKes(v.kes)}</strong> {v.withinTarget !== null && <span className={`vstate ${v.withinTarget ? 'ok' : 'bad'}`}>{t(v.withinTarget ? 'ovWithin' : 'ovOver')}</span>}</td></tr>); return (
              <section className="card" key={tr}>
                <h3>{t(tr === 't1' ? 'ovT1' : 'ovT2')}</h3>
                <table className="table"><tbody>
                  {row(t('ovPerDecided'), x.costPerDecidedCase)}{row(t('ovPerApproved'), x.costPerApprovedCase)}{row(t('ovPerUnit'), x.costPerVerifiedUnit)}
                  <tr><td>{t('ovDecided')} / {t('ovApproved')}</td><td>{x.decided} / {x.approved}</td></tr>
                  <tr><td>{t('ovVerifiedUnits')}</td><td>{x.verifiedUnits}</td></tr>
                  <tr><td>{t('ovHandlingHours')}</td><td>{fmtNum(x.handlingHours, 2)}</td></tr>
                  <tr><td>{t('ovRate')}</td><td>{fmtKes(x.reviewerRate.kesPerHour)}{x.reviewerRate.source === 'entered' && x.reviewerRate.fromMonth && <span className="msg"> · {t('ovRateFrom').replace('{m}', x.reviewerRate.fromMonth)}</span>}</td></tr>
                  <tr><td>{t('ovReviewerCost')}</td><td>{fmtKes(x.reviewerCostKes)}</td></tr>
                  <tr><td>{t('ovOtherCosts')}</td><td>{fmtKes(x.otherCostsKes)}</td></tr>
                  <tr><td>{t('ovSharedCosts')}</td><td>{fmtKes(x.sharedCostsAllocatedKes)}</td></tr>
                  <tr><td><strong>{t('ovTotalCost')}</strong></td><td><strong>{fmtKes(x.totalCostKes)}</strong></td></tr>
                  <tr><td>{t('ovUntimed')}</td><td>{x.decidedWithoutTimeRecord}</td></tr>
                </tbody></table>
                {x.reviewerRate.source === 'placeholder' && <p className="msg" role="note">{t('ovRatePlaceholder')}</p>}
              </section>); })}
          </div>
          <p className="msg">{t('ovMethod')}</p><p className="msg">{t('ovExcludes')}</p><p className="msg">{t('ovTimeNote')}</p>
        </>
      )}
      <section className="card" aria-labelledby="h-inputs">
        <h2 id="h-inputs">{t('ovInputs')}</h2>
        <p className="msg">{t('ovInputsHint')}</p>
        <form onSubmit={add}>
          <div className="toolbar">
            <div><label htmlFor="ci-tier">{t('ovTier')}</label>
              <select id="ci-tier" value={tier} onChange={(e) => setTier(e.target.value)}><option value="all">{t('ovTierAll')}</option><option value="t1">{t('ovT1')}</option><option value="t2">{t('ovT2')}</option></select></div>
            <div><label htmlFor="ci-kind">{t('ovKind')}</label>
              <select id="ci-kind" value={kind} onChange={(e) => setKind(e.target.value)}>{KINDS.map((k) => <option key={k} value={k}>{word('ovk_' + k)}</option>)}</select></div>
            <div><label htmlFor="ci-amount">{t('ovAmount')}</label><input id="ci-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            <div style={{ flex: 1 }}><label htmlFor="ci-note">{t('ovNote')}</label><input id="ci-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} /></div>
            <button type="submit">{t('ovAdd')}</button>
          </div>
        </form>
        {msg && <p className="msg" role="status">{msg}</p>}{err && <p className="error" role="alert">{err}</p>}
        {inputs && (inputs.inputs.length === 0 ? <div className="empty">{t('ovNoInputs')}</div> : (
          <table className="table">
            <thead><tr><th>{t('ovTier')}</th><th>{t('ovKind')}</th><th>{t('ovAmount')}</th><th>{t('ovNote')}</th><th>{t('ovEntered')}</th></tr></thead>
            <tbody>{inputs.inputs.map((i: any) => <tr key={i.id}><td>{i.tier === 'all' ? t('ovTierAll') : t(i.tier === 't1' ? 'ovT1' : 'ovT2')}</td><td>{word('ovk_' + i.kind)}</td><td>{fmtKes(i.amountKes)}</td><td>{i.note ?? ''}</td><td>{new Date(i.enteredAt).toLocaleString()}</td></tr>)}</tbody>
          </table>))}
      </section>
    </>
  );
}
