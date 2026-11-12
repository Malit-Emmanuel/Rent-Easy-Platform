import { normaliseKenyanPhone } from '../modules/auth/phone';

export type OtpChannelName = 'whatsapp' | 'sms';

export interface AfricasTalkingConfig { username: string; apiKey: string; senderId?: string; baseUrl: string }
export interface WhatsAppConfig {
  phoneNumberId: string; accessToken: string; template: string; language: string; apiBase: string; apiVersion: string;
}

export interface AppConfig {
  databaseUrl: string; redisUrl: string; port: number; appEnv: string;
  smsProvider: 'fake' | 'africastalking'; paymentsProvider: 'fake';
  jwtSecret: string; otpPepper: string; otpResendCooldownSec: number;
  /** Order in which sign-in codes are tried. WhatsApp is only used when it is configured. */
  otpChannels: OtpChannelName[];
  /** Hard stop on paid messages per rolling 24 hours (WhatsApp + SMS together). */
  otpDailyCap: number;
  /** Numbers that get their code in the server log instead of a real message. Honoured in production for a few named test accounts only. */
  devOtpAllowlist: string[];
  /** Per-address limits on sign-in (see S7). Counted per visitor address, never per person. */
  authIpLimits: { otpRequestsPer10Min: number; distinctPhonesPerHour: number; verifyFailsPer10Min: number };
  /** Shared secret the dashboard sends so the API may trust the visitor address it forwards. Optional; without it the address seen by the API is the dashboard's. */
  trustedProxyKey?: string;
  africasTalking?: AfricasTalkingConfig;
  whatsapp?: WhatsAppConfig;
}

/** True only in real production. Vercel sets NODE_ENV=production for previews too, so we use APP_ENV / VERCEL_ENV instead. */
export function isProductionEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.APP_ENV ?? (env.VERCEL_ENV === 'production' ? 'production' : 'development')) === 'production';
}

export const MAX_DEV_ALLOWLIST = 5;

/** Fail fast at boot on missing/invalid config. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const need = (k: string) => { const v = env[k]; if (!v) throw new Error(`Missing env ${k}`); return v; };
  const secret = (k: string) => { const v = need(k); if (v.length < 32) throw new Error(`${k} must be at least 32 characters`); return v; };
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 0) throw new Error('PORT must be a non-negative integer');
  const sms = env.SMS_PROVIDER ?? 'fake', pay = env.PAYMENTS_PROVIDER ?? 'fake';
  if (sms !== 'fake' && sms !== 'africastalking') throw new Error(`SMS_PROVIDER must be fake or africastalking`);
  if (pay !== 'fake') throw new Error('Only the fake payments provider is implemented; no payments vendor is selected yet');
  const production = isProductionEnv(env);
  const appEnv = production ? 'production' : (env.APP_ENV ?? 'development');

  let africasTalking: AfricasTalkingConfig | undefined;
  if (sms === 'africastalking') {
    const live = (env.AT_ENV ?? 'sandbox') === 'live';
    if (!['live', 'sandbox'].includes(env.AT_ENV ?? 'sandbox')) throw new Error('AT_ENV must be sandbox or live');
    if (production && !live) throw new Error('AT_ENV must be live in production');
    africasTalking = {
      username: need('AT_USERNAME'), apiKey: need('AT_API_KEY'),
      senderId: env.AT_SENDER_ID || undefined,
      baseUrl: env.AT_BASE_URL || (live ? 'https://api.africastalking.com' : 'https://api.sandbox.africastalking.com'),
    };
    if (africasTalking.senderId && !/^[A-Za-z0-9_-]{1,11}$/.test(africasTalking.senderId)) throw new Error('AT_SENDER_ID must be 1 to 11 letters, digits, hyphens or underscores');
  }

  let whatsapp: WhatsAppConfig | undefined;
  if (env.WHATSAPP_PHONE_NUMBER_ID || env.WHATSAPP_ACCESS_TOKEN) {
    whatsapp = {
      phoneNumberId: need('WHATSAPP_PHONE_NUMBER_ID'), accessToken: need('WHATSAPP_ACCESS_TOKEN'),
      template: env.WHATSAPP_TEMPLATE || 'zuri_login_code', language: env.WHATSAPP_TEMPLATE_LANG || 'en',
      apiBase: env.WHATSAPP_API_BASE || 'https://graph.facebook.com', apiVersion: env.WHATSAPP_API_VERSION || 'v23.0',
    };
  }

  const wanted = (env.OTP_CHANNELS ?? (whatsapp ? 'whatsapp,sms' : 'sms')).split(',').map((s) => s.trim()).filter(Boolean);
  const otpChannels: OtpChannelName[] = [];
  for (const c of wanted) {
    if (c !== 'whatsapp' && c !== 'sms') throw new Error(`OTP_CHANNELS has an unknown channel: ${c}`);
    if (c === 'whatsapp' && !whatsapp) throw new Error('OTP_CHANNELS includes whatsapp but WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN are not set');
    if (!otpChannels.includes(c)) otpChannels.push(c);
  }

  const devOtpAllowlist: string[] = [];
  for (const raw of (env.DEV_OTP_ALLOWLIST ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const p = normaliseKenyanPhone(raw);
    if (!p) throw new Error('DEV_OTP_ALLOWLIST contains an invalid Kenyan number');
    if (!devOtpAllowlist.includes(p)) devOtpAllowlist.push(p);
  }
  if (devOtpAllowlist.length > MAX_DEV_ALLOWLIST) throw new Error(`DEV_OTP_ALLOWLIST may hold at most ${MAX_DEV_ALLOWLIST} numbers`);

  const otpDailyCap = Number(env.OTP_DAILY_CAP ?? 2000);
  if (!Number.isInteger(otpDailyCap) || otpDailyCap < 1) throw new Error('OTP_DAILY_CAP must be a positive integer');

  if (production && sms === 'fake' && !whatsapp && devOtpAllowlist.length === 0) {
    throw new Error('Production needs a real message channel (SMS_PROVIDER=africastalking or WhatsApp) or a DEV_OTP_ALLOWLIST of named test numbers');
  }

  const posInt = (name: string, dflt: number) => { const v = Number(env[name] ?? dflt); if (!Number.isInteger(v) || v < 1) throw new Error(`${name} must be a positive integer`); return v; };
  const authIpLimits = { otpRequestsPer10Min: posInt('AUTH_IP_OTP_PER_10MIN', 20), distinctPhonesPerHour: posInt('AUTH_IP_PHONES_PER_HOUR', 10), verifyFailsPer10Min: posInt('AUTH_IP_VERIFY_FAILS_PER_10MIN', 30) };
  const trustedProxyKey = env.TRUSTED_PROXY_KEY || undefined;
  if (trustedProxyKey && trustedProxyKey.length < 32) throw new Error('TRUSTED_PROXY_KEY must be at least 32 characters');

  return {
    databaseUrl: need('DATABASE_URL'), redisUrl: env.REDIS_URL ?? '', port, appEnv,
    smsProvider: sms, paymentsProvider: 'fake',
    jwtSecret: secret('JWT_SECRET'), otpPepper: secret('OTP_PEPPER'),
    otpResendCooldownSec: Number(env.OTP_RESEND_COOLDOWN_SEC ?? 30),
    otpChannels, otpDailyCap, devOtpAllowlist, authIpLimits, trustedProxyKey, africasTalking, whatsapp,
  };
}
