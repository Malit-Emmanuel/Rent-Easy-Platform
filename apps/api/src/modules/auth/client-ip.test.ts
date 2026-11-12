import test from 'node:test';
import assert from 'node:assert/strict';
import { clientIp, normaliseIp } from './client-ip';

const KEY = 'k'.repeat(40);
const req = (headers: Record<string, string>, remote = '10.0.0.9') => ({ headers, socket: { remoteAddress: remote } });

test('addresses are normalised: IPv4 as is, mapped IPv4 unwrapped, IPv6 by its /64, junk refused', () => {
  assert.equal(normaliseIp('41.90.1.2'), '41.90.1.2');
  assert.equal(normaliseIp('::ffff:41.90.1.2'), '41.90.1.2');
  assert.equal(normaliseIp('2001:db8:1:2:aaaa:bbbb:cccc:dddd'), normaliseIp('2001:db8:1:2::1'));
  assert.notEqual(normaliseIp('2001:db8:1:2::1'), normaliseIp('2001:db8:1:3::1'));
  assert.equal(normaliseIp('2001:db8::5'), '2001:db8:0:0::/64');
  for (const bad of ['', 'not an ip', '999.1.1.1', undefined]) assert.equal(normaliseIp(bad as any), null);
});

test('the forwarded address is believed only with the right secret', () => {
  assert.equal(clientIp(req({ 'x-zuri-client-ip': '41.1.1.1', 'x-zuri-proxy-key': KEY }), KEY), '41.1.1.1');
  assert.equal(clientIp(req({ 'x-zuri-client-ip': '41.1.1.1', 'x-zuri-proxy-key': 'wrong'.padEnd(40, 'x') }), KEY), '10.0.0.9', 'wrong secret ignored');
  assert.equal(clientIp(req({ 'x-zuri-client-ip': '41.1.1.1' }), KEY), '10.0.0.9', 'no secret ignored');
  assert.equal(clientIp(req({ 'x-zuri-client-ip': '41.1.1.1', 'x-zuri-proxy-key': KEY }), undefined), '10.0.0.9', 'nothing configured: never trusted');
  assert.equal(clientIp(req({ 'x-zuri-client-ip': 'garbage', 'x-zuri-proxy-key': KEY }), KEY), '10.0.0.9');
});

test('without the secret, only the last X-Forwarded-For entry counts (the caller writes the earlier ones)', () => {
  assert.equal(clientIp(req({ 'x-forwarded-for': '6.6.6.6, 7.7.7.7, 41.2.2.2' })), '41.2.2.2');
  assert.equal(clientIp(req({})), '10.0.0.9');
  assert.equal(clientIp(req({}, '::ffff:10.0.0.9')), '10.0.0.9');
  assert.equal(clientIp({ headers: {} }), null);
});
