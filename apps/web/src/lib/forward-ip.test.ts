import test from 'node:test';
import assert from 'node:assert/strict';
import { forwardIpHeaders, visitorIp } from './forward-ip';

const hdr = (o: Record<string, string>) => ({ get: (n: string) => o[n] ?? null });
const KEY = 'k'.repeat(40);

test('the visitor address comes from x-real-ip, else the first x-forwarded-for entry', () => {
  assert.equal(visitorIp(hdr({ 'x-real-ip': '41.1.1.1', 'x-forwarded-for': '9.9.9.9' })), '41.1.1.1');
  assert.equal(visitorIp(hdr({ 'x-forwarded-for': '41.2.2.2, 10.0.0.1' })), '41.2.2.2');
  assert.equal(visitorIp(hdr({})), undefined);
});

test('headers are sent only when there is an address and a long enough secret', () => {
  assert.deepEqual(forwardIpHeaders('41.1.1.1', KEY), { 'x-zuri-client-ip': '41.1.1.1', 'x-zuri-proxy-key': KEY });
  assert.deepEqual(forwardIpHeaders(undefined, KEY), {});
  assert.deepEqual(forwardIpHeaders('41.1.1.1', undefined), {});
  assert.deepEqual(forwardIpHeaders('41.1.1.1', 'short'), {});
});
