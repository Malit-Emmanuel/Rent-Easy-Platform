import test from 'node:test';
import assert from 'node:assert/strict';
import { poolConfigFromEnv as cfg } from './db-config';

const base = 'postgresql://u:p@h.example.com:5432/postgres';
const CA = '-----BEGIN CERTIFICATE-----\nABC\n-----END CERTIFICATE-----';

test('strips sslmode from the URL in every position', () => {
  assert.equal(cfg({ DATABASE_URL: base + '?sslmode=require' }).connectionString, base);
  assert.equal(cfg({ DATABASE_URL: base + '?sslmode=require&x=1' }).connectionString, base + '?x=1');
  assert.equal(cfg({ DATABASE_URL: base + '?x=1&sslmode=require' }).connectionString, base + '?x=1');
  assert.equal(cfg({ DATABASE_URL: base + '?a=1&sslmode=require&b=2' }).connectionString, base + '?a=1&b=2');
  assert.equal(cfg({ DATABASE_URL: base }).connectionString, base);
});
test('CA certificate is honoured even when the URL says sslmode=require', () => {
  assert.deepEqual(cfg({ DATABASE_URL: base + '?sslmode=require', DATABASE_SSL_CA: CA }).ssl, { ca: CA, rejectUnauthorized: true });
});
test('sslmode=require without a CA uses verified TLS with system roots', () => {
  assert.deepEqual(cfg({ DATABASE_URL: base + '?sslmode=require' }).ssl, { rejectUnauthorized: true });
  assert.deepEqual(cfg({ DATABASE_URL: base, DATABASE_SSL: 'require' }).ssl, { rejectUnauthorized: true });
});
test('verify-full and verify-ca stay verified', () => {
  assert.deepEqual(cfg({ DATABASE_URL: base + '?sslmode=verify-full' }).ssl, { rejectUnauthorized: true });
});
test('no-verify is an explicit, visible opt-out', () => {
  assert.deepEqual(cfg({ DATABASE_URL: base + '?sslmode=no-verify' }).ssl, { rejectUnauthorized: false });
});
test('local development: nothing set means no TLS; disable means no TLS', () => {
  assert.equal(cfg({ DATABASE_URL: 'postgres://khp:khp@localhost:5432/khp' }).ssl, undefined);
  assert.equal(cfg({ DATABASE_URL: base + '?sslmode=disable' }).ssl, undefined);
});
test('pool size comes from PG_POOL_MAX', () => {
  assert.equal(cfg({ DATABASE_URL: base }).max, 5);
  assert.equal(cfg({ DATABASE_URL: base, PG_POOL_MAX: '3' }).max, 3);
});
test('the pg library keeps our CA once sslmode is gone (checked against the real library)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const CP = require('pg/lib/connection-parameters');
  const c = cfg({ DATABASE_URL: base + '?sslmode=require', DATABASE_SSL_CA: CA });
  const p = new CP(c);
  assert.equal(p.ssl.ca, CA); assert.equal(p.ssl.rejectUnauthorized, true);
});
