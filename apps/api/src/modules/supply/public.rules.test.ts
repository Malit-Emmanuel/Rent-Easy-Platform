import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePublicQuery, RateWindow } from './public.rules';

test('parsePublicQuery: defaults and valid filters', () => {
  assert.deepEqual(parsePublicQuery({}).value, { sort: 'new', limit: 20, offset: 0 });
  const p = parsePublicQuery({ node: '3', bedrooms: '2', minRent: '20000', maxRent: '60000', verified: '1', sort: 'cost', limit: '10', offset: '20' });
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.value, { nodeId: 3, bedrooms: 2, minRent: 20000, maxRent: 60000, verified: true, sort: 'cost', limit: 10, offset: 20 });
});

test('parsePublicQuery: rejects text, negatives, absurd sizes, and unknown options', () => {
  for (const q of [{ node: 'x' }, { bedrooms: '-1' }, { bedrooms: '99' }, { maxRent: '1e9' }, { limit: '500' }, { offset: '99999' }, { verified: '0' }, { sort: 'random' }, { minRent: '9', maxRent: '5' }, { node: ['1', '2'] }]) {
    assert.ok(parsePublicQuery(q as any).errors.length > 0, JSON.stringify(q));
  }
  assert.equal(parsePublicQuery({ limit: '0' }).value.limit, 1, 'limit is at least 1');
});

test('RateWindow: allows up to the limit per address, then refuses, then resets after the window', () => {
  let now = 1000; const w = new RateWindow(3, 60_000, () => now);
  assert.deepEqual([1, 2, 3, 4].map(() => w.take('a')), [true, true, true, false]);
  assert.equal(w.take('b'), true, 'another address is not affected');
  now += 60_001; assert.equal(w.take('a'), true, 'a new window starts');
});
