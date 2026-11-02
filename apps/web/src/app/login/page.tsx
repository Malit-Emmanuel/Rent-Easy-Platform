'use client';
import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/components/I18n';

// Set NEXT_PUBLIC_HIDE_DEV_NOTICE=true on Vercel once real sign-in messages are live.
const SHOW_DEV_NOTICE = process.env.NEXT_PUBLIC_HIDE_DEV_NOTICE !== 'true';

export default function Login() {
  const { t } = useI18n(); const router = useRouter();
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState(''), [code, setCode] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [info, setInfo] = useState('');
  const [channel, setChannel] = useState<'whatsapp' | 'sms'>('sms');
  const [smsAfter, setSmsAfter] = useState(30), [waited, setWaited] = useState(false);

  // WhatsApp cannot always tell us a number is not on WhatsApp, so offer SMS once the resend wait is over.
  useEffect(() => {
    if (step !== 'code' || channel !== 'whatsapp') return;
    setWaited(false);
    const id = setTimeout(() => setWaited(true), smsAfter * 1000);
    return () => clearTimeout(id);
  }, [step, channel, smsAfter, info]);

  async function post(url: string, body: unknown) {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, json: await r.json().catch(() => ({})) as any };
  }
  async function request(viaSms: boolean) {
    setBusy(true); setError(''); setInfo('');
    const r = await post('/api/auth/request', viaSms ? { phone, channel: 'sms' } : { phone });
    setBusy(false);
    if (r.status === 200) {
      setChannel(r.json.channel === 'whatsapp' ? 'whatsapp' : 'sms');
      setSmsAfter(Number(r.json.resendAfterSec) > 0 ? Number(r.json.resendAfterSec) : 30);
      if (viaSms) setInfo(t('smsSent'));
      setStep('code');
    } else setError(r.status === 400 ? t('badPhone') : r.status === 429 ? t('tooMany') : r.status === 503 ? t('codeUnavailable') : t('genericError'));
  }
  function sendCode(e: FormEvent) { e.preventDefault(); request(false); }
  async function verify(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    const r = await post('/api/auth/verify', { phone, code });
    setBusy(false);
    if (r.status === 200) { router.replace('/'); router.refresh(); } else setError(r.status === 401 ? t('badCode') : r.status === 429 ? t('tooMany') : t('genericError'));
  }
  return (
    <>
      <h1>{t('signIn')}</h1>
      {step === 'phone' ? (
        <form onSubmit={sendCode}>
          <label htmlFor="phone">{t('phoneLabel')}</label>
          <input id="phone" inputMode="tel" autoComplete="tel" placeholder={t('phoneHint')} value={phone} onChange={(e) => setPhone(e.target.value)} required />
          <button disabled={busy}>{t('sendCode')}</button>
        </form>
      ) : (
        <form onSubmit={verify}>
          <p className="msg">{info || (channel === 'whatsapp' ? t('codeSentWhatsapp') : t('codeSent'))}</p>
          <label htmlFor="code">{t('codeLabel')}</label>
          <input id="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} required />
          <div className="row"><button disabled={busy}>{t('verify')}</button>
            <button type="button" className="link" onClick={() => { setStep('phone'); setCode(''); setError(''); setInfo(''); }}>{t('back')}</button></div>
          {channel === 'whatsapp' && waited && (
            <p><button type="button" className="link" disabled={busy} onClick={() => request(true)}>{t('sendBySms')}</button></p>
          )}
        </form>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      {SHOW_DEV_NOTICE && <p className="notice">{t('devNotice')}</p>}
    </>
  );
}
