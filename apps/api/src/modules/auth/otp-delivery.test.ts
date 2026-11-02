import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { OtpChannel, OtpChannelId, OtpChannelSet } from '../../providers/ports';
import { AuditService } from '../audit/audit.service';
import { OtpDeliveryService, OtpPolicy } from './otp-delivery.service';

const dbTest = process.env.DATABASE_URL ? test : test.skip;

function channel(name: OtpChannelId, fail?: string): OtpChannel & { sent: string[] } {
  const sent: string[] = [];
  return { name, sent, async send(to, code) { if (fail) throw new Error(fail); sent.push(`${to}:${code}`); return { providerMessageId: `${name}-1` }; } };
}
async function setup(channels: OtpChannelSet, policy: Partial<OtpPolicy> = {}) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const svc = new OtpDeliveryService(pool, channels, new AuditService(pool), { order: ['whatsapp', 'sms'], dailyCap: 1_000_000, allowlist: [], ...policy });
  const challenge = async () => {
    const id = randomUUID();
    await pool.query(`INSERT INTO identity.otp_challenges (id, phone, code_hmac, expires_at) VALUES ($1,'+254700000001',$2, now() + interval '5 minutes')`, [id, Buffer.from('x')]);
    return id;
  };
  const rows = async (id: string) => (await pool.query('SELECT channel, status, provider_message_id, error_code FROM identity.otp_deliveries WHERE challenge_id=$1 ORDER BY created_at, id', [id])).rows;
  return { pool, svc, challenge, rows };
}

dbTest('WhatsApp first: accepted, one record, no fallback', async () => {
  const wa = channel('whatsapp'), sms = channel('sms');
  const { pool, svc, challenge, rows } = await setup({ whatsapp: wa, sms });
  try {
    const id = await challenge();
    assert.deepEqual(await svc.deliver(id, '+254712345678', '111111', 5), { channel: 'whatsapp', fellBack: false });
    assert.equal(sms.sent.length, 0); assert.equal(wa.sent.length, 1);
    assert.deepEqual(await rows(id), [{ channel: 'whatsapp', status: 'accepted', provider_message_id: 'whatsapp-1', error_code: null }]);
  } finally { await pool.end(); }
});

dbTest('when WhatsApp refuses, SMS is used and both attempts are recorded', async () => {
  const sms = channel('sms');
  const { pool, svc, challenge, rows } = await setup({ whatsapp: channel('whatsapp', 'wa_http_400_131026'), sms });
  try {
    const id = await challenge();
    assert.deepEqual(await svc.deliver(id, '+254712345678', '111111', 5), { channel: 'sms', fellBack: true });
    assert.deepEqual((await rows(id)).map((r) => `${r.channel}:${r.status}:${r.error_code}`), ['whatsapp:failed:wa_http_400_131026', 'sms:accepted:null']);
  } finally { await pool.end(); }
});

dbTest('asking for SMS puts SMS first; an unconfigured preference is ignored', async () => {
  const wa = channel('whatsapp'), sms = channel('sms');
  const { pool, svc, challenge } = await setup({ whatsapp: wa, sms });
  try {
    assert.equal((await svc.deliver(await challenge(), '+254712345678', '111111', 5, 'sms')).channel, 'sms');
    assert.equal(wa.sent.length, 0);
    const only = await setup({ sms: channel('sms') });
    try { assert.equal((await only.svc.deliver(await only.challenge(), '+254712345678', '111111', 5, 'whatsapp')).channel, 'sms'); } finally { await only.pool.end(); }
  } finally { await pool.end(); }
});

dbTest('every channel refusing gives a 503 and stores only short codes (never numbers or codes)', async () => {
  const { pool, svc, challenge, rows } = await setup({ whatsapp: channel('whatsapp', 'boom +254712345678 111111'), sms: channel('sms', 'at_status_501') });
  try {
    const id = await challenge();
    await assert.rejects(svc.deliver(id, '+254712345678', '111111', 5), (e: any) => e.getStatus?.() === 503);
    const r = await rows(id);
    assert.deepEqual(r.map((x) => x.error_code), ['send_failed', 'at_status_501']);
    assert.ok(!JSON.stringify(r).match(/254712345678|111111/));
  } finally { await pool.end(); }
});

dbTest('with no channel configured the answer is 503, not a crash', async () => {
  const { pool, svc, challenge } = await setup({});
  try { await assert.rejects(svc.deliver(await challenge(), '+254712345678', '111111', 5), (e: any) => e.getStatus?.() === 503); }
  finally { await pool.end(); }
});

dbTest('allow-listed numbers use the log channel only; other numbers never do', async () => {
  const dev = channel('dev'), sms = channel('sms');
  const { pool, svc, challenge, rows } = await setup({ dev, sms }, { order: ['sms'], allowlist: ['+254702461238'] });
  try {
    const id = await challenge();
    assert.equal((await svc.deliver(id, '+254702461238', '222222', 5)).channel, 'dev');
    assert.equal(sms.sent.length, 0); assert.equal((await rows(id))[0].channel, 'dev');
    assert.deepEqual(svc.plan('+254712345678'), ['sms']);
  } finally { await pool.end(); }
});

dbTest('the daily cap stops paid messages, is audited, and does not stop allow-listed test numbers', async () => {
  const sms = channel('sms'), dev = channel('dev');
  const { pool, svc, challenge } = await setup({ sms, dev }, { order: ['sms'], dailyCap: 1, allowlist: ['+254702461238'] });
  try {
    await pool.query(`DELETE FROM identity.otp_deliveries`);
    assert.equal((await svc.deliver(await challenge(), '+254712345678', '111111', 5)).channel, 'sms');
    const before = (await pool.query(`SELECT count(*)::int n FROM governance.audit_events WHERE action='auth.otp_cap_reached'`)).rows[0].n;
    await assert.rejects(svc.deliver(await challenge(), '+254722222222', '111111', 5), (e: any) => e.getStatus?.() === 503);
    assert.equal(sms.sent.length, 1);
    assert.equal((await pool.query(`SELECT count(*)::int n FROM governance.audit_events WHERE action='auth.otp_cap_reached'`)).rows[0].n, before + 1);
    assert.equal((await svc.deliver(await challenge(), '+254702461238', '111111', 5)).channel, 'dev');
  } finally { await pool.end(); }
});

dbTest('deliveries disappear with their challenge (purge leaves no orphan)', async () => {
  const { pool, svc, challenge, rows } = await setup({ sms: channel('sms') }, { order: ['sms'] });
  try {
    const id = await challenge(); await svc.deliver(id, '+254712345678', '111111', 5);
    await pool.query('DELETE FROM identity.otp_challenges WHERE id=$1', [id]);
    assert.equal((await rows(id)).length, 0);
  } finally { await pool.end(); }
});
