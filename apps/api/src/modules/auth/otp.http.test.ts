import test from 'node:test';
import assert from 'node:assert/strict';
import { bootApp } from '../../test-utils/http';
import { OTP_CHANNELS } from '../../providers/ports';
import { OTP_POLICY } from './otp-delivery.service';

const dbTest = process.env.DATABASE_URL ? test : test.skip;

dbTest('sign-in code requests: channel choice, delivery record, audit without the phone number', async () => {
  const h = await bootApp();
  try {
    const p = h.newPhone();
    const r = await h.call('POST', '/auth/otp/request', { phone: p });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { expiresInSec: 300, channel: 'sms', resendAfterSec: 0 });
    assert.equal((await h.call('POST', '/auth/otp/request', { phone: p, channel: 'sms' })).status, 200);
    assert.equal((await h.call('POST', '/auth/otp/request', { phone: p, channel: 'pigeon' })).status, 400);
    const d = await h.pool.query(`SELECT d.channel, d.status, d.error_code FROM identity.otp_deliveries d JOIN identity.otp_challenges c ON c.id=d.challenge_id WHERE c.phone=$1`, [p]);
    assert.equal(d.rowCount, 2); assert.ok(d.rows.every((x: any) => x.channel === 'sms' && x.status === 'accepted'));
    const a = await h.pool.query(`SELECT metadata, subject_id FROM governance.audit_events WHERE action='auth.otp_requested' ORDER BY occurred_at DESC LIMIT 1`);
    assert.deepEqual(a.rows[0].metadata, { channel: 'sms', fellBack: false });
    assert.ok(!JSON.stringify(a.rows[0]).includes(p.slice(-8)));
    assert.match(h.lastMsg(p), /Your Zuri Home code is \d{6}\. It expires in 5 minutes/);
  } finally { await h.close(); }
});

dbTest('when nothing can be sent the answer is 503 and the unsent code cannot be used', async () => {
  const h = await bootApp();
  const channels: any = h.app.get(OTP_CHANNELS), original = channels.sms;
  try {
    channels.sms = { name: 'sms', send: async () => { throw new Error('at_status_501'); } };
    const p = h.newPhone();
    const r = await h.call('POST', '/auth/otp/request', { phone: p });
    assert.equal(r.status, 503);
    assert.match(r.body.message, /cannot be sent right now/);
    const c = await h.pool.query(`SELECT consumed_at FROM identity.otp_challenges WHERE phone=$1`, [p]);
    assert.ok(c.rows[0].consumed_at, 'unsent challenge is closed');
    channels.sms = original;
    assert.equal((await h.call('POST', '/auth/otp/request', { phone: p })).status, 200);   // recovers once the provider does
  } finally { channels.sms = original; await h.close(); }
});

dbTest('allow-listed test numbers get no real message, and the response does not reveal that', async () => {
  const h = await bootApp();
  const policy: any = h.app.get(OTP_POLICY);
  try {
    const p = h.newPhone(); policy.allowlist.push(p);
    const r = await h.call('POST', '/auth/otp/request', { phone: p });
    assert.equal(r.status, 200); assert.equal(r.body.channel, 'sms');
    const { SMS_PORT } = await import('../../providers/ports');
    assert.equal((h.app.get(SMS_PORT) as any).outbox.filter((m: any) => m.to === p).length, 0, 'nothing went to the SMS provider');
    const d = await h.pool.query(`SELECT d.channel FROM identity.otp_deliveries d JOIN identity.otp_challenges c ON c.id=d.challenge_id WHERE c.phone=$1`, [p]);
    assert.deepEqual(d.rows.map((x: any) => x.channel), ['dev']);
  } finally { policy.allowlist.length = 0; await h.close(); }
});
