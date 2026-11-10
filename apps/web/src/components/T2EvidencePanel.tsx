'use client';
import { useState } from 'react';
import { useI18n } from '@/components/I18n';
import { api } from '@/lib/client';
import { Answers, T2_QUESTIONS, bandTone, fmtDistance, mapLink } from '@/lib/t2review';

/**
 * The reviewer's view of a T2 case: what the manager was asked to do, the recording, the two location readings against the
 * property position, and the computer's notes (advice only). The checklist is controlled by the page so the decision form can use it.
 */
export default function T2EvidencePanel({ caseId, t2, canOpen, answers, setAnswers, onWatched }: {
  caseId: string; t2: any; canOpen: boolean; answers: Answers; setAnswers: (a: Answers) => void; onWatched: () => void;
}) {
  const { t } = useI18n(); const word = (k: string) => (t as any)(k) as string;
  const [url, setUrl] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState(false);

  async function watch() {
    setErr(''); setBusy(true);
    const r = await api(`review/cases/${caseId}/video/link`, { method: 'POST' });
    setBusy(false);
    if (r.status === 200) { setUrl(r.data.url); onWatched(); } else setErr(t('t2r_videoError'));
  }
  const reading = (label: string, r: any) => (
    <tr>
      <td><strong>{label}</strong><div className="msg">{new Date(r.at).toLocaleTimeString()}</div></td>
      <td><span className={`vstate ${bandTone(r.band)}`}>{r.band ? word('t2r_band_' + r.band) : '–'}</span></td>
      <td>{fmtDistance(r.distanceM)} {t('t2r_fromPin')}<div className="msg">± {Math.round(r.accuracyM)} m {t('t2r_accuracy')}</div></td>
      <td><a href={mapLink(r.lat, r.lon)} target="_blank" rel="noopener noreferrer">{t('t2r_openMap')}</a></td>
    </tr>
  );
  const late = t2.window.submittedAfterExpirySec > 0;
  return (
    <section className="panel" aria-label={t('t2r_title')}>
      <h2>{t('t2r_title')}</h2>
      <p className="msg">{t('t2r_advice')}</p>
      {t2.isAppealOfRecording && <p className="msg">{t('t2r_appealRecording')}</p>}
      <p className="msg">{t('t2r_safety')}</p>

      <h3>{t('t2r_challenge')}</h3>
      <table className="table"><tbody>
        <tr><td>{t('t2r_code')}</td><td><strong className="mono">{t2.challenge.code}</strong></td></tr>
        <tr><td>{t('t2r_date')}</td><td>{new Date(t2.challenge.issuedAt).toLocaleDateString()}</td></tr>
        <tr><td>{t('t2r_units')}</td><td>{t2.challenge.units.join(', ')}</td></tr>
        <tr><td>{t('t2r_window')}</td><td>{new Date(t2.challenge.issuedAt).toLocaleTimeString()} – {new Date(t2.challenge.expiresAt).toLocaleTimeString()}
          <div className={t2.window.startedInside ? 'msg' : 'error'}>{t2.window.startedInside ? t('t2r_startedInside') : t('t2r_startedOutside')}</div>
          {late && <div className="msg">{t('t2r_late').replace('{s}', String(t2.window.submittedAfterExpirySec))}</div>}</td></tr>
      </tbody></table>

      <h3>{t('t2r_video')}</h3>
      <p className="msg">{t('t2r_attempt').replace('{n}', String(t2.attempt)).replace('{total}', String(t2.attempts.length))}{t2.attempts.length > 1 ? ` · ${t('t2r_attemptHint')}` : ''}</p>
      {!t2.video.available ? <p className="error">{t('t2r_unavailable')}</p> : (<>
        {url && <video className="t2video" src={url} controls playsInline preload="metadata" aria-label={t('t2r_video')} />}
        <div className="row">
          {canOpen && <button type="button" onClick={watch} disabled={busy}>{busy ? t('loading') : url ? t('t2r_watch') + ' ↻' : t('t2r_watch')}</button>}
          {t2.videoOpened && <span className="badge">{t('t2r_watched')}</span>}
        </div>
        {canOpen && <p className="msg">{t('t2r_watchHint')}</p>}
        {err && <p className="error" role="alert">{err}</p>}
      </>)}

      <h3>{t('t2r_location')}</h3>
      {t2.pin ? <p className="msg">{t('t2r_pin')}: <a href={mapLink(t2.pin.lat, t2.pin.lon)} target="_blank" rel="noopener noreferrer">{t('t2r_openMap')}</a> · {t('t2r_mapNote')}</p> : <p className="msg">{t('t2r_noPin')}</p>}
      <table className="table"><tbody>{reading(t('t2r_start'), t2.start)}{reading(t('t2r_end'), t2.end)}</tbody></table>
      <p className="msg">{t('t2r_apart')}: {fmtDistance(t2.readingsApartM)}</p>

      <h3>{t('t2r_hintsTitle')}</h3>
      {t2.hints.flags.length === 0 ? <p className="msg">{t('t2r_noHints')}</p> : <p>{t2.hints.flags.map((f: string) => <span className="badge" key={f}>{word('flag_' + f)}</span>)}</p>}

      {canOpen && (
        <fieldset className="t2check">
          <legend><h3>{t('t2r_checklist')}</h3></legend>
          <p className="msg">{t('t2r_checklistHint')}</p>
          {T2_QUESTIONS.map((q) => (
            <div className="t2q" key={q} role="radiogroup" aria-label={word('t2r_q_' + q)}>
              <span>{word('t2r_q_' + q)}</span>
              <label><input type="radio" name={q} checked={answers[q] === true} onChange={() => setAnswers({ ...answers, [q]: true })} />{t('t2r_yes')}</label>
              <label><input type="radio" name={q} checked={answers[q] === false} onChange={() => setAnswers({ ...answers, [q]: false })} />{t('t2r_no')}</label>
            </div>
          ))}
        </fieldset>
      )}
    </section>
  );
}
