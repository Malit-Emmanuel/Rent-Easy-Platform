'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '@/components/I18n';
import { api } from '@/lib/client';
import { AUDIO_BPS, MAX_SECONDS, MIN_SECONDS, VIDEO_BPS, baseMime, blockerKey, cameraError, checkTake, clockSkewMs, fmtClock, inAppBrowser, pickMime, positionError, secondsLeft, stamp, t2Error } from '@/lib/recorder';

type Unit = { id: string; label: string };
type Challenge = { id: string; mine: boolean; expiresAt: string; takesLeft: number; code?: string; unitsToShow?: Unit[] };
type Status = {
  now: string; enabled: boolean; eligible: boolean; blockers: string[]; badge: null | { validUntil: string; ownExpiry: string; renewable: boolean }; suspended?: null | { validUntil: string };
  badgeEnded?: null | { kind: 'revoked' | 'expired'; on: string; reasonCode: string | null; note: string | null }; challenge: Challenge | null;
  case: null | { status: string; dueAt: string | null; reasonCode: string | null; note: string | null; isAppeal: boolean; needsNewRecording: boolean; canAppeal: boolean };
};
type Reading = { lat: number; lon: number; accuracyM: number; at: string };
type Phase = 'idle' | 'notice' | 'challenge' | 'camera' | 'locating' | 'recording' | 'review' | 'uploading';

function readPosition(skew: number): Promise<Reading> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject({ code: 2 });
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, accuracyM: Math.round(p.coords.accuracy * 10) / 10, at: stamp(Date.now(), skew) }),
      (e) => reject({ code: e.code }), { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 });
  });
}

/** Manager side of T2: notice, one-time code, in-browser recorder, upload. The computed hints are never shown here. */
export default function T2Card({ orgId, propertyId, canWrite }: { orgId: string; propertyId: string; canWrite: boolean }) {
  const { t } = useI18n(); const word = (k: string) => (t as any)(k);
  const base = `orgs/${orgId}/properties/${propertyId}`; const url = `${base}/verification/t2`;
  const [s, setS] = useState<Status | null>(null), [phase, setPhase] = useState<Phase>('idle');
  const [agree, setAgree] = useState(false), [busy, setBusy] = useState(false), [err, setErr] = useState(''), [msg, setMsg] = useState('');
  const [left, setLeft] = useState(0), [elapsed, setElapsed] = useState(0), [blobUrl, setBlobUrl] = useState('');
  const skew = useRef(0), video = useRef<HTMLVideoElement>(null), stream = useRef<MediaStream | null>(null), rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]), startRead = useRef<Reading | null>(null), endRead = useRef<Reading | null>(null), took = useRef<{ blob: Blob; seconds: number; mime: string } | null>(null);
  const uploaded = useRef<{ fileId: string; challengeId: string } | null>(null), timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    const r = await api<Status>(url);
    if (r.status === 200 && r.data) { setS(r.data); skew.current = clockSkewMs(r.data.now, Date.now()); }
  }, [url]);
  useEffect(() => { load(); }, [load]);
  const ch = s?.challenge?.mine ? s.challenge : null;
  useEffect(() => { if (!ch) return; const tick = () => setLeft(secondsLeft(ch.expiresAt, Date.now())); tick(); const i = setInterval(tick, 1000); return () => clearInterval(i); }, [ch]);
  const stopMedia = useCallback(() => { stream.current?.getTracks().forEach((x) => x.stop()); stream.current = null; if (timer.current) clearInterval(timer.current); timer.current = null; }, []);
  useEffect(() => () => { stopMedia(); }, [stopMedia]);
  useEffect(() => () => { if (blobUrl) URL.revokeObjectURL(blobUrl); }, [blobUrl]);

  if (!s) return null;
  const c = s.case;
  if (!s.enabled && !c && !s.badge && !s.suspended && !s.badgeEnded) return null;       // switched off: the card stays out of sight

  const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
  const open = !!c && c.status !== 'approved';          // a newer request is under way or was turned down
  const ended = !s.badge && !s.suspended && !open ? s.badgeEnded ?? null : null;
  const label = s.badge ? t('t2_state_approved') : s.suspended && !open ? t('t2_state_suspended') : open ? (c!.isAppeal && ['submitted', 'in_review'].includes(c!.status) ? t('t2_state_appeal') : word('t2_state_' + c!.status)) : ended ? t(ended.kind === 'revoked' ? 't2_state_withdrawn' : 't2_state_expired') : t('t2_none');
  const tone = s.badge ? 'ok' : open ? (c!.status === 'rejected' ? 'bad' : 'wait') : s.suspended ? 'wait' : ended?.kind === 'revoked' ? 'bad' : 'none';
  const mayStart = !s.badge || s.badge.renewable;
  const inApp = typeof navigator !== 'undefined' && inAppBrowser(navigator.userAgent);
  const mime = typeof window !== 'undefined' && typeof MediaRecorder !== 'undefined' ? pickMime((m) => MediaRecorder.isTypeSupported(m)) : null;
  const canRecord = !inApp && !!mime && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

  const fail = (status: number, code?: string) => setErr(t(t2Error(status, code) as any));
  const reset = () => { stopMedia(); setPhase('idle'); setAgree(false); setElapsed(0); setBlobUrl(''); took.current = null; uploaded.current = null; };

  async function getCode() {
    setBusy(true); setErr(''); setMsg('');
    const r = await api<any>(`${url}/challenge`, { method: 'POST', body: { consent: true } });
    setBusy(false);
    if (r.status !== 201) { fail(r.status, r.data?.code); if (r.data?.code === 'challenge_active') { await load(); setPhase('challenge'); } return; }
    skew.current = clockSkewMs(r.data.now, Date.now()); await load(); setPhase('challenge');
  }

  async function openCamera() {
    setErr('');
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: true });
    } catch (e: any) { setErr(t(cameraError(e?.name))); return; }
    setPhase('camera');
    setTimeout(() => { if (video.current && stream.current) { video.current.srcObject = stream.current; video.current.muted = true; video.current.play().catch(() => {}); } }, 0);
  }

  async function begin() {
    setErr(''); setPhase('locating');
    try { startRead.current = await readPosition(skew.current); } catch (e: any) { setErr(t(positionError(e?.code))); setPhase('camera'); return; }
    if (!stream.current || !mime) { setPhase('idle'); return; }
    chunks.current = [];
    const r = new MediaRecorder(stream.current, { mimeType: mime, videoBitsPerSecond: VIDEO_BPS, audioBitsPerSecond: AUDIO_BPS });
    rec.current = r; const t0 = Date.now();
    r.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
    r.onstop = async () => {
      if (timer.current) clearInterval(timer.current); timer.current = null;
      const seconds = (Date.now() - t0) / 1000;
      try { endRead.current = await readPosition(skew.current); } catch (e: any) { stopMedia(); setErr(t(positionError(e?.code))); setPhase('idle'); return; }
      stopMedia();
      const blob = new Blob(chunks.current, { type: baseMime(mime) });
      took.current = { blob, seconds, mime: baseMime(mime) };
      const bad = checkTake(seconds, blob.size);
      if (bad !== 'ok') { setErr(t(bad === 'too_short' ? 't2_err_short' : 't2_err_large')); setPhase('idle'); took.current = null; return; }
      setBlobUrl(URL.createObjectURL(blob)); setPhase('review');
    };
    r.start(1000); setElapsed(0); setPhase('recording');
    timer.current = setInterval(() => { const e = Math.floor((Date.now() - t0) / 1000); setElapsed(e); if (e >= MAX_SECONDS && r.state === 'recording') r.stop(); }, 500);
  }
  const stop = () => { if (rec.current?.state === 'recording') rec.current.stop(); };
  const retake = () => { setBlobUrl(''); took.current = null; setErr(''); openCamera(); };

  async function send() {
    if (!ch || !took.current || !startRead.current || !endRead.current) return;
    setErr(''); setPhase('uploading');
    const { blob, mime: m } = took.current;
    try {
      let fileId = uploaded.current?.challengeId === ch.id ? uploaded.current.fileId : '';
      if (!fileId) {
        const tk = await api<any>(`${url}/challenge/${ch.id}/take`, { method: 'POST', body: { mimeType: m, sizeBytes: blob.size } });
        if (tk.status !== 201) { fail(tk.status, tk.data?.code); setPhase('review'); return; }
        let put: Response;
        try { put = await fetch(tk.data.upload.url, { method: tk.data.upload.method, headers: tk.data.upload.headers, body: blob }); } catch { setErr(t('err_uploadFailed')); setPhase('review'); return; }
        if (!put.ok) { setErr(t('err_uploadFailed')); setPhase('review'); return; }
        const done = await api<any>(`${base}/files/${tk.data.fileId}/complete`, { method: 'POST' });
        if (done.status !== 200) { fail(done.status, done.data?.code); setPhase('review'); return; }
        fileId = tk.data.fileId; uploaded.current = { fileId, challengeId: ch.id };
      }
      const sub = await api<any>(`${url}/submit`, { method: 'POST', body: { challengeId: ch.id, fileId, start: startRead.current, end: endRead.current } });
      if (sub.status !== 201) { fail(sub.status, sub.data?.code); setPhase('review'); return; }
      reset(); setMsg(t('t2_sent')); load();
    } catch { setErr(t('genericError')); setPhase('review'); }
  }

  async function appeal() {
    setBusy(true); setErr(''); setMsg('');
    const r = await api<any>(`${url}/appeal`, { method: 'POST' }); setBusy(false);
    if (r.status === 201) { setMsg(t('t2_appealed')); load(); } else fail(r.status, r.data?.code);
  }

  const date = new Date(Date.now() + skew.current).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const live = phase === 'camera' || phase === 'locating' || phase === 'recording';

  return (
    <section className="panel vcard" aria-labelledby="t2-h">
      <div className="row between"><h2 id="t2-h">{t('t2_title')}</h2><span className={`vstate ${tone}`}>{label}</span></div>
      {s.badge && <p className="msg">{t('t2_verifiedUntil')} {new Date(s.badge.validUntil).toLocaleDateString()}</p>}
      {s.badge?.renewable && <p className="msg">{t('t2_renewHint')}</p>}
      {!s.badge && s.suspended && <p className="msg">{t('t2_suspendedNote')}</p>}
      {ended && (
        <p className="msg">{ended.kind === 'revoked' ? t('t2_endedRevoked') : t('t2_endedExpired')} {new Date(ended.on).toLocaleDateString()}.
          {ended.kind === 'revoked' && ended.reasonCode ? <><br /><strong>{t('pvReason')}:</strong> {word('rc_' + ended.reasonCode)}{ended.note ? <><br /><strong>{t('pvNote')}:</strong> {ended.note}</> : null}</> : null}
          {' '}{t('t2_endedNext')}</p>
      )}
      {!s.badge && c && ['submitted', 'in_review'].includes(c.status) && c.dueAt && <p className="msg">{t('t2_due')} {new Date(c.dueAt).toLocaleDateString()}. {t('pvEvidenceFrozen')}</p>}
      {!s.badge && c && ['rejected', 'needs_changes'].includes(c.status) && (
        <p className="msg"><strong>{t('pvReason')}:</strong> {c.reasonCode ? word('rc_' + c.reasonCode) : ''}{c.note ? <><br /><strong>{t('pvNote')}:</strong> {c.note}</> : null}{c.status === 'needs_changes' ? <><br />{t('t2_needsHint')}</> : null}</p>
      )}
      {c?.status === 'rejected' && c.isAppeal && !s.badge && <p className="msg"><strong>{t('pvFinal')}</strong></p>}

      {canWrite && phase === 'idle' && mayStart && (
        <>
          {!c && !s.badge && !ended && !s.suspended && <p className="msg">{t('t2_intro')}</p>}
          {s.blockers.filter((b) => b !== 't2_disabled' && b !== 'already_t2').length > 0 && !(s.challenge?.mine) && <ul className="msg">{s.blockers.filter((b) => b !== 't2_disabled' && b !== 'already_t2').map((b) => <li key={b}>{word(blockerKey(b))}</li>)}</ul>}
          {(s.eligible || ch) && (
            ch ? <button onClick={() => setPhase('challenge')}>{t('t2_openCamera')}</button>
               : <button disabled={busy || !canRecord} onClick={() => setPhase('notice')}>{c?.needsNewRecording ? t('t2_state_needs_changes') : s.badge?.renewable ? t('t2_renew') : t('t2_start')}</button>
          )}
          {(s.eligible || ch) && inApp && <p className="error" role="alert">{t('t2_inApp')}</p>}
          {(s.eligible || ch) && !inApp && !canRecord && <p className="error" role="alert">{t('t2_noRecorder')}</p>}
        </>
      )}
      {canWrite && c?.canAppeal && phase === 'idle' && (<><p className="msg">{t('t2_appealHint')}</p><button disabled={busy} onClick={appeal}>{t('t2_appeal')}</button></>)}

      {phase === 'notice' && (
        <div>
          <h3>{t('t2_noticeTitle')}</h3>
          <ul className="msg"><li>{t('t2_notice1')}</li><li>{t('t2_notice2')}</li><li>{t('t2_notice3')}</li><li>{t('t2_notice4')}</li></ul>
          <label className="row"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> {t('t2_consent')}</label>
          <div className="row"><button disabled={!agree || busy} onClick={getCode}>{t('t2_continue')}</button><button type="button" className="secondary" onClick={reset}>{t('t2_cancel')}</button></div>
        </div>
      )}

      {ch && ['challenge', 'camera', 'locating', 'recording', 'review', 'uploading'].includes(phase) && (
        <div className="t2challenge">
          <p className="msg"><strong>{t('t2_codeTitle')}</strong></p>
          <p className="t2code" aria-live="polite">{ch.code}</p>
          <p className="msg">{t('t2_dateLabel')}: <strong>{date}</strong></p>
          <p className="msg">{t('t2_showUnits')} <strong>{ch.unitsToShow?.map((u) => u.label).join(', ')}</strong></p>
          <p className="msg">{t('t2_timeLeft')}: <strong>{fmtClock(left)}</strong> · {t('t2_takesLeft')}: <strong>{ch.takesLeft}</strong></p>
          {left === 0 && <p className="error" role="alert">{t('t2_expired')} <button type="button" onClick={() => { reset(); load(); }}>{t('t2_newCode')}</button></p>}
        </div>
      )}
      {ch && left > 0 && phase === 'challenge' && <div className="row"><button onClick={openCamera}>{t('t2_openCamera')}</button><button type="button" className="secondary" onClick={reset}>{t('t2_cancel')}</button></div>}

      {live && (
        <div>
          <video ref={video} className="t2video" playsInline muted aria-label={t('t2_rec')} />
          {phase === 'camera' && <div className="row"><button onClick={begin} disabled={left === 0}>{t('t2_record')}</button><button type="button" className="secondary" onClick={reset}>{t('t2_cancel')}</button></div>}
          {phase === 'locating' && <p className="msg" role="status">{t('t2_getLoc')}</p>}
          {phase === 'recording' && <><p className="msg" role="status"><strong>{t('t2_rec')}</strong> {fmtClock(elapsed)} / {fmtClock(MAX_SECONDS)}{elapsed < MIN_SECONDS ? ` · ${t('t2_minNote')}` : ''}</p><button onClick={stop} disabled={elapsed < MIN_SECONDS}>{t('t2_stop')}</button></>}
        </div>
      )}

      {(phase === 'review' || phase === 'uploading') && blobUrl && (
        <div>
          <video className="t2video" src={blobUrl} controls playsInline aria-label={t('t2_review')} />
          {phase === 'review' && <><p className="msg">{t('t2_review')}</p><div className="row"><button onClick={send} disabled={left === 0}>{t('t2_send')}</button><button type="button" className="secondary" onClick={retake}>{t('t2_retake')}</button></div></>}
          {phase === 'uploading' && <p className="msg" role="status">{t('t2_uploading')}</p>}
        </div>
      )}
      {msg && <p className="msg" role="status">{msg}</p>}
      {err && <p className="error" role="alert">{err}</p>}
    </section>
  );
}
