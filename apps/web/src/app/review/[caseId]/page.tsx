'use client';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useI18n } from '@/components/I18n';
import PageHead from '@/components/PageHead';
import { api } from '@/lib/client';
import { formatBytes } from '@/lib/files';
import { span } from '@/lib/span';

const REASONS = ['doc_unreadable', 'doc_owner_mismatch', 'doc_expired', 'authorisation_missing', 'property_mismatch', 'suspected_forgery', 'other'];

export default function CasePage() {
  const { t } = useI18n(); const word = (k: string) => (t as any)(k) as string; const router = useRouter();
  const { caseId } = useParams<{ caseId: string }>();
  const [c, setC] = useState<any>(null), [gone, setGone] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [decision, setDecision] = useState<'approve' | 'needs_changes' | 'reject'>('approve'), [reason, setReason] = useState('doc_unreadable'), [note, setNote] = useState('');

  const load = useCallback(async () => {
    const r = await api(`review/cases/${caseId}`);
    if (r.status === 200) setC(r.data); else setGone(true);
  }, [caseId]);
  useEffect(() => { load(); }, [load]);

  async function open(fileId: string) {
    setError('');
    const w = window.open('', '_blank');   // opened first so the pop-up blocker allows it
    const r = await api(`review/cases/${caseId}/files/${fileId}/link`, { method: 'POST' });
    if (r.status === 200 && w) { w.opener = null; w.location.href = r.data.url; load(); } else { w?.close(); setError(t('genericError')); }
  }
  async function submit(e: FormEvent) {
    e.preventDefault(); setError('');
    if (!window.confirm(t('rvConfirm'))) return;
    setBusy(true);
    const body: any = { decision }; if (decision !== 'approve') { body.reasonCode = reason; if (note.trim()) body.note = note.trim(); }
    const r = await api(`review/cases/${caseId}/decision`, { method: 'POST', body });
    setBusy(false);
    if (r.status === 200) router.push('/review');
    else if (r.data?.code === 'documents_not_opened') setError(t('rvOpenAll'));
    else if (r.status === 400) setError(reason === 'other' && !note.trim() ? t('rvNeedNote') : t('genericError'));
    else setError(t('genericError'));
  }
  async function release() { const r = await api(`review/cases/${caseId}/release`, { method: 'POST' }); if (r.status === 200) router.push('/review'); else setError(t('genericError')); }

  if (gone) return <p className="error">{t('rvGone')}</p>;
  if (!c) return <p className="msg">{t('loading')}</p>;
  const open_ = c.status === 'in_review' && c.claimedByMe;
  return (
    <>
      <PageHead back={{ href: '/review', label: t('rvNav') }} eyebrow={c.orgName} title={c.propertyName}>
        {c.isAppeal && <span className="badge">{t('rvAppeal')}</span>}
        {c.minutesLeft !== null && open_ && <span className={`vstate ${c.breached ? 'bad' : 'wait'}`}>{c.breached ? `${t('rvOverdue')} ${span(c.minutesLeft)}` : `${span(c.minutesLeft)} ${t('rvLeft')}`}</span>}
      </PageHead>
      <p className="msg">{c.address}</p>
      {c.riskFlags.filter((f: string) => f !== 'appeal').length > 0 && <p>{c.riskFlags.filter((f: string) => f !== 'appeal').map((f: string) => <span className="badge" key={f}>{word('flag_' + f)}</span>)}</p>}
      {c.earlierDecision && <div className="panel"><strong>{t('rvEarlier')}</strong><p className="msg">{word('rc_' + c.earlierDecision.reasonCode)}{c.earlierDecision.note ? ` — ${c.earlierDecision.note}` : ''}</p></div>}

      <h2>{t('files')}</h2>
      <p className="msg">{t('rvOpenHint')}</p>
      <table className="table">
        <thead><tr><th>{t('rvDocument')}</th><th>{t('rvUploaded')}</th><th /></tr></thead>
        <tbody>{c.files.map((f: any) => (
          <tr key={f.id}>
            <td><strong>{word('dt_' + f.docType)}</strong><div className="msg">{f.originalName} · {formatBytes(f.sizeBytes)}</div></td>
            <td>{new Date(f.uploadedAt).toLocaleDateString()}</td>
            <td className="actions">{f.opened && <span className="badge">{t('rvSeen')}</span>}{open_ && <button type="button" onClick={() => open(f.id)}>{t('open')}</button>}</td>
          </tr>))}</tbody>
      </table>

      {open_ ? (
        <form onSubmit={submit} className="panel">
          <h2>{t('rvDecision')}</h2>
          <div className="row" role="radiogroup" aria-label={t('rvDecision')}>
            {(['approve', 'needs_changes', 'reject'] as const).map((d) => (
              <label key={d} style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="radio" name="d" checked={decision === d} onChange={() => setDecision(d)} style={{ width: 'auto' }} />{word('rv_' + d)}</label>
            ))}
          </div>
          {decision === 'approve' && <p className="msg">{c.allOpened ? t('rvApproveHint') : t('rvOpenAll')}</p>}
          {decision !== 'approve' && (<>
            <label htmlFor="rs">{t('pvReason')}</label>
            <select id="rs" value={reason} onChange={(e) => setReason(e.target.value)}>{REASONS.map((r) => <option key={r} value={r}>{word('rc_' + r)}</option>)}</select>
            <label htmlFor="nt">{t('pvNote')} {reason === 'other' ? '' : `(${t('optional')})`}</label>
            <textarea id="nt" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} required={reason === 'other'} />
            <p className="msg">{t('rvManagerSees')}</p>
          </>)}
          <div className="row"><button disabled={busy || (decision === 'approve' && !c.allOpened)} className={decision === 'reject' ? 'danger' : undefined}>{t('rvSubmit')}</button>
            <button type="button" className="link" onClick={release}>{t('rvRelease')}</button></div>
        </form>
      ) : c.decided && <p className="panel msg">{word('pv' + c.decided.status.charAt(0).toUpperCase() + c.decided.status.slice(1))}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </>
  );
}
