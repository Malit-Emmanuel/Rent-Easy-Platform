import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'crypto';
import { bootApp } from '../../test-utils/http';

const t = process.env.DATABASE_URL ? test : test.skip;
const KEY = 'z'.repeat(40);
const ipv4 = () => `198.51.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;   // documentation range, new on every run

t('S7: per-address limits on code requests and failed guesses; addresses stored only as hashes; purged after a day', async (ctx) => {
  const h = await bootApp({ AUTH_IP_OTP_PER_10MIN: '4', AUTH_IP_PHONES_PER_HOUR: '3', AUTH_IP_VERIFY_FAILS_PER_10MIN: '3', TRUSTED_PROXY_KEY: KEY });
  try {
    const J = { 'content-type': 'application/json' };
    const asIp = (ip: string, trusted = true) => ({ ...J, ...(trusted ? { 'x-zuri-client-ip': ip, 'x-zuri-proxy-key': KEY } : { 'x-forwarded-for': `1.1.1.1, ${ip}` }) });
    const request = (ip: string, phone: string, trusted = true) => h.raw('/auth/otp/request', asIp(ip, trusted), JSON.stringify({ phone }));
    const verify = (ip: string, phone: string, code: string, trusted = true) => h.raw('/auth/otp/verify', asIp(ip, trusted), JSON.stringify({ phone, code }));

    await ctx.test('one address cannot spray codes at many numbers', async () => {
      const ip = ipv4(), phones = [h.newPhone(), h.newPhone(), h.newPhone(), h.newPhone()];
      for (const p of phones.slice(0, 3)) assert.equal((await request(ip, p)).status, 200);
      const blocked = await request(ip, phones[3]);
      assert.equal(blocked.status, 429, 'a fourth different number within the hour is refused');
      assert.equal(h.pool && (await h.pool.query(`SELECT 1 FROM identity.otp_challenges WHERE phone=$1`, [phones[3]])).rowCount, 0, 'no code was made or sent');
      assert.equal((await request(ipv4(), phones[3])).status, 200, 'a different address is not affected');
    });

    await ctx.test('one address is held to its 10-minute allowance even when the numbers repeat', async () => {
      const ip = ipv4(), [a, b, c] = [h.newPhone(), h.newPhone(), h.newPhone()];
      for (const p of [a, b, c, a]) assert.equal((await request(ip, p)).status, 200);
      assert.equal((await request(ip, b)).status, 429, 'the fifth request in ten minutes is refused');
    });

    await ctx.test('failed guesses count per address across numbers; a good sign-in from another address still works', async () => {
      const ip = ipv4(), victims = [h.newPhone(), h.newPhone()];
      for (const p of victims) assert.equal((await request(ipv4(), p)).status, 200);
      assert.equal((await verify(ip, victims[0], '000001')).status, 401);
      assert.equal((await verify(ip, victims[1], '000001')).status, 401);
      assert.equal((await verify(ip, '+254700000000', '000001')).status, 401, 'a number with no code also counts');
      assert.equal((await verify(ip, victims[0], '000002')).status, 429, 'the address is now paused');
      const real = h.newPhone(); assert.equal((await request(ipv4(), real)).status, 200);
      assert.equal((await verify(ipv4(), real, h.lastMsg(real).match(/\d{6}/)![0])).status, 200, 'other addresses are unaffected');
    });

    await ctx.test('a header of the caller\'s own cannot dodge the limit: without the secret only the host-added address counts', async () => {
      const ip = ipv4(), phones = [h.newPhone(), h.newPhone(), h.newPhone(), h.newPhone()];
      for (const p of phones.slice(0, 3)) assert.equal((await request(ip, p, false)).status, 200);
      // the caller makes up a new forwarded address each time; the last entry (ours) is the same, so the limit still bites
      const r = await h.raw('/auth/otp/request', { ...J, 'x-forwarded-for': `${ipv4()}, ${ip}`, 'x-zuri-client-ip': ipv4(), 'x-zuri-proxy-key': 'bad'.padEnd(40, 'x') }, JSON.stringify({ phone: phones[3] }));
      assert.equal(r.status, 429);
    });

    await ctx.test('only hashes are stored, never the address; the daily purge removes old rows', async () => {
      const ip = ipv4(); await request(ip, h.newPhone());
      const rows = (await h.pool.query(`SELECT ip_hash, phone_hash FROM identity.auth_ip_events ORDER BY id DESC LIMIT 1`)).rows[0];
      assert.equal(rows.ip_hash.length, 32); assert.ok(!rows.ip_hash.toString('utf8').includes(ip));
      assert.equal((await h.pool.query(`SELECT count(*)::int n FROM information_schema.columns WHERE table_schema='identity' AND table_name='auth_ip_events' AND column_name IN ('ip','address','ip_address')`)).rows[0].n, 0);
      await h.pool.query(`INSERT INTO identity.auth_ip_events (ip_hash, kind, created_at) VALUES ($1,'verify_fail', now() - interval '2 days')`, [randomBytes(32)]);
      const { JobsService } = await import('../jobs/jobs.service');
      const out: any = await h.app.get(JobsService).handlers['purge-auth-data']();
      assert.ok(out.ipEvents >= 1);
      assert.equal((await h.pool.query(`SELECT count(*)::int n FROM identity.auth_ip_events WHERE created_at < now() - interval '1 day'`)).rows[0].n, 0);
    });

    await ctx.test('an invalid number is still a plain 400 and does not use up the allowance', async () => {
      const ip = ipv4();
      for (let i = 0; i < 6; i++) assert.equal((await request(ip, '12345')).status, 400);
      assert.equal((await request(ip, h.newPhone())).status, 200);
    });
  } finally { await h.close(); }
});
