'use client';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useI18n } from '@/components/I18n';
import Loading from '@/components/Loading';
import PageHead from '@/components/PageHead';
import T2EvidencePanel from '@/components/T2EvidencePanel';
import { api } from '@/lib/client';
import { formatBytes } from '@/lib/files';
import { span } from '@/lib/span';
import { Answers, T1_REASONS, T2_REASONS, t2Gate } from '@/lib/t2review';

export default function CasePage() {
  const { t } = useI18n(); const word = (k: string) => (t as any)(k) as string; const router = useRouter();
  const { caseId } = useParams<{ caseId: string }>();
  const [c, setC] = useState<any>(null), [gone, setGone] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [decision, setDecision] = useState<'approve' | 'needs_changes' | 'reject'>('approve'), [reason, setReason] = useState(''), [note, setNote] = useState('');
  const [answers, setAnswers] = useState<Answers>({}), [watched, setWatched] = useState(false);

  const load = useCallback(async () => {
    const r = await api(`review/cases/${caseId}`);
    if (r.status === 200) { setC(r.data); setReason((cur) => cur || (r.data.tier === 't2' ? T2_REASONS[0] : T1_REASONS[0])); } else setGone(true);
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
    if (isT2) body.checklist = answers;
    const r = await api(`review/cases/${caseId}/decision`, { method: 'POST', body });
    setBusy(false);
    if (r.status === 200) router.push('/review');
    else if (r.data?.code === 'documents_not_opened') setError(isT2 ? t('t2r_openDocs') : t('rvOpenAll'));
    else if (r.data?.code === 'video_not_opened') setError(t('t2r_watchFirst'));
    else if (r.data?.code === 't1_not_valid') setError(t('t2r_t1Lapsed'));
    else if (r.data?.code === 'checklist_incomplete') setError(t('t2r_hasNo'));
    else if (r.status === 400) setError(reason === 'other' && !note.trim() ? t('rvNeedNote') : t('genericError'));
    else setError(t('genericError'));
  }
  async function release() { const r = await api(`review/cases/${caseId}/release`, { method: 'POST' }); if (r.status === 200) router.push('/review'); else setError(t('genericError')); }

  if (gone) return <p className="error">{t('rvGone')}</p>;
  if (!c) return <Loading />;
  const isT2 = c.tier === 't2';
  const open_ = c.status === 'in_review' && c.claimedByMe;
  const reasons = isT2 ? T2_REASONS : T1_REASONS;
  const docsOpened = c.files.every((f: any) => f.opened);
  const gate = isT2 ? t2Gate(decision, answers, watched || !!c.t2?.videoOpened, docsOpened) : (decision === 'approve' && !c.allOpened ? 'docs' : 'ok');
  const gateText: Record<string, string> = { answer_all: t('t2r_answerAll'), has_no: t('t2r_hasNo'), watch: t('t2r_watchFirst'), docs: isT2 ? t('t2r_openDocs') : t('rvOpenAll') };
  return (
    <>
      <PageHead back={{ href: '/review', label: t('rvNav') }} eyebrow={c.orgName} title={c.propertyName}>
        {isT2 && <span className="badge">{t('flag_t2')}</span>}
        {c.isAppeal && <span className="badge">{t('rvAppeal')}</span>}
        {c.minutesLeft !== null && open_ && <span className={`vstate ${c.breached ? 'bad' : 'wait'}`}>{c.breached ? `${t('rvOverdue')} ${span(c.minutesLeft)}` : `${span(c.minutesLeft)} ${t('rvLeft')}`}</span>}
      </PageHead>
      <p className="msg">{c.address}</p>
      {!isT2 && c.riskFlags.filter((f: string) => f !== 'appeal').length > 0 && <p>{c.riskFlags.filter((f: string) => f !== 'appeal').map((f: string) => <span className="badge" key={f}>{word('flag_' + f)}</span>)}</p>}
      {c.earlierDecision && <div className="panel"><strong>{t('rvEarlier')}</strong><p className="msg">{word('rc_' + c.earlierDecision.reasonCode)}{c.earlierDecision.note ? ` — ${c.earlierDecision.note}` : ''}</p></div>}

      {isT2 && c.t2 && <T2EvidencePanel caseId={caseId} t2={c.t2} canOpen={open_} answers={answers} setAnswers={setAnswers} onWatched={() => { setWatched(true); load(); }} />}

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
          {decision === 'approve' && <p className="msg">{gate === 'ok' ? (isT2 ? t('t2r_approveHint') : t('rvApproveHint')) : gateText[gate]}</p>}
          {decision !== 'approve' && isT2 && gate === 'answer_all' && <p className="msg">{gateText.answer_all}</p>}
          {decision !== 'approve' && (<>
            <label htmlFor="rs">{t('pvReason')}</label>
            <select id="rs" value={reason} onChange={(e) => setReason(e.target.value)}>{reasons.map((r) => <option key={r} value={r}>{word('rc_' + r)}</option>)}</select>
            <label htmlFor="nt">{t('pvNote')} {reason === 'other' ? '' : `(${t('optional')})`}</label>
            <textarea id="nt" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} required={reason === 'other'} />
            <p className="msg">{t('rvManagerSees')}</p>
          </>)}
          <div className="row"><button disabled={busy || gate !== 'ok'} className={decision === 'reject' ? 'danger' : undefined}>{t('rvSubmit')}</button>
            <button type="button" className="link" onClick={release}>{t('rvRelease')}</button></div>
        </form>
      ) : c.decided && <p className="panel msg">{word('pv' + c.decided.status.charAt(0).toUpperCase() + c.decided.status.slice(1))}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </>
  );
}
