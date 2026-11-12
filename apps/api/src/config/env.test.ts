import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from './env';

const ok = { DATABASE_URL: 'd', JWT_SECRET: 'j'.repeat(32), OTP_PEPPER: 'p'.repeat(32) };
test('requires DATABASE_URL', () => assert.throws(() => loadConfig({ ...ok, DATABASE_URL: '' })));
test('rejects short secrets', () => assert.throws(() => loadConfig({ ...ok, JWT_SECRET: 'short' })));
test('rejects an unknown SMS vendor and any payments vendor', () => {
  assert.throws(() => loadConfig({ ...ok, SMS_PROVIDER: 'twilio' }), /SMS_PROVIDER/);
  assert.throws(() => loadConfig({ ...ok, PAYMENTS_PROVIDER: 'pesapal' }), /payments/);
});
test('production needs a real channel or a named test allow-list', () => {
  assert.throws(() => loadConfig({ ...ok, APP_ENV: 'production' }), /real message channel/);
  assert.throws(() => loadConfig({ ...ok, VERCEL_ENV: 'production' }), /real message channel/);
  assert.equal(loadConfig({ ...ok, APP_ENV: 'production', DEV_OTP_ALLOWLIST: '0702461238' }).devOtpAllowlist[0], '+254702461238');
  const at = { SMS_PROVIDER: 'africastalking', AT_USERNAME: 'zuri', AT_API_KEY: 'k', AT_ENV: 'live' };
  assert.equal(loadConfig({ ...ok, ...at, APP_ENV: 'production' }).africasTalking?.baseUrl, 'https://api.africastalking.com');
});
test('production refuses the Africa\'s Talking sandbox', () => {
  assert.throws(() => loadConfig({ ...ok, SMS_PROVIDER: 'africastalking', AT_USERNAME: 'sandbox', AT_API_KEY: 'k', APP_ENV: 'production', DEV_OTP_ALLOWLIST: '0702461238' }), /live/);
});
test('NODE_ENV=production alone (Vercel sets it on previews) does not trigger the production rules', () => {
  assert.doesNotThrow(() => loadConfig({ ...ok, NODE_ENV: 'production', VERCEL_ENV: 'preview' }));
});
test('Africa\'s Talking needs its username and key; sandbox is the default', () => {
  assert.throws(() => loadConfig({ ...ok, SMS_PROVIDER: 'africastalking' }), /AT_USERNAME/);
  const c = loadConfig({ ...ok, SMS_PROVIDER: 'africastalking', AT_USERNAME: 'sandbox', AT_API_KEY: 'k' });
  assert.equal(c.africasTalking?.baseUrl, 'https://api.sandbox.africastalking.com');
  assert.throws(() => loadConfig({ ...ok, SMS_PROVIDER: 'africastalking', AT_USERNAME: 'u', AT_API_KEY: 'k', AT_SENDER_ID: 'TOO LONG NAME!' }), /AT_SENDER_ID/);
});
test('WhatsApp is optional, needs both values, and defaults to WhatsApp first then SMS', () => {
  assert.deepEqual(loadConfig(ok).otpChannels, ['sms']);
  assert.throws(() => loadConfig({ ...ok, WHATSAPP_PHONE_NUMBER_ID: '123' }), /WHATSAPP_ACCESS_TOKEN/);
  const c = loadConfig({ ...ok, WHATSAPP_PHONE_NUMBER_ID: '123', WHATSAPP_ACCESS_TOKEN: 'tok' });
  assert.deepEqual(c.otpChannels, ['whatsapp', 'sms']);
  assert.equal(c.whatsapp?.template, 'zuri_login_code');
  assert.throws(() => loadConfig({ ...ok, OTP_CHANNELS: 'whatsapp' }), /not set/);
  assert.throws(() => loadConfig({ ...ok, OTP_CHANNELS: 'telegram' }), /unknown channel/);
});
test('allow-list holds valid numbers only, at most five; daily cap must be positive', () => {
  assert.throws(() => loadConfig({ ...ok, DEV_OTP_ALLOWLIST: '12345' }), /invalid/);
  assert.throws(() => loadConfig({ ...ok, DEV_OTP_ALLOWLIST: '0711111111,0722222222,0733333333,0744444444,0755555555,0766666666' }), /at most 5/);
  assert.throws(() => loadConfig({ ...ok, OTP_DAILY_CAP: '0' }), /OTP_DAILY_CAP/);
  assert.equal(loadConfig(ok).otpDailyCap, 2000);
});
test('valid config', () => assert.equal(loadConfig(ok).port, 3000));
test('per-address sign-in limits have defaults, must be positive whole numbers, and the proxy secret must be long', () => {
  assert.deepEqual(loadConfig(ok).authIpLimits, { otpRequestsPer10Min: 20, distinctPhonesPerHour: 10, verifyFailsPer10Min: 30 });
  assert.equal(loadConfig({ ...ok, AUTH_IP_OTP_PER_10MIN: '5' }).authIpLimits.otpRequestsPer10Min, 5);
  for (const bad of ['0', '-1', 'x', '2.5']) assert.throws(() => loadConfig({ ...ok, AUTH_IP_VERIFY_FAILS_PER_10MIN: bad }), /AUTH_IP_VERIFY_FAILS_PER_10MIN/);
  assert.equal(loadConfig(ok).trustedProxyKey, undefined);
  assert.throws(() => loadConfig({ ...ok, TRUSTED_PROXY_KEY: 'short' }), /TRUSTED_PROXY_KEY/);
  assert.equal(loadConfig({ ...ok, TRUSTED_PROXY_KEY: 'k'.repeat(32) }).trustedProxyKey, 'k'.repeat(32));
});
