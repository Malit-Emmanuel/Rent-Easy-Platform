import test from 'node:test';
import assert from 'node:assert/strict';
import { ALLOWED, checkCosts, missingCosts, phaseOf, totalMoveIn } from './listings.rules';

const full = { rent: 45000, deposit: 90000, utilityDeposit: 5000, serviceCharge: 3000, agentFee: 0 };

test('checkCosts: all five are required for a full set, zero is fine except for rent', () => {
  assert.deepEqual(checkCosts(full, 'all').errors, []);
  assert.equal(checkCosts({ ...full, agentFee: undefined }, 'all').errors.length, 1);
  assert.match(checkCosts({ ...full, rent: 0 }, 'all').errors[0], /rent must be more than 0/);
  assert.equal(checkCosts({ ...full, deposit: 0, utilityDeposit: 0, serviceCharge: 0 }, 'all').errors.length, 0);
});

test('checkCosts: whole shillings only, no negatives, no text, no absurd amounts', () => {
  for (const bad of [-1, 1.5, '45000', null, Number.NaN, 1e12]) assert.equal(checkCosts({ ...full, rent: bad }, 'all').errors.length, 1, String(bad));
  assert.equal(checkCosts({}, 'some').errors[0], 'nothing to update');
  assert.equal(checkCosts('x', 'some').errors[0], 'nothing to update');
});

test('totalMoveIn is the sum of all five and is null until every cost is entered', () => {
  assert.equal(totalMoveIn(full), 143000);
  assert.equal(totalMoveIn({ ...full, agentFee: null }), null);
  assert.deepEqual(missingCosts({ rent: 1, deposit: null }), ['deposit', 'utilityDeposit', 'serviceCharge', 'agentFee']);
});

test('status rules: only a draft can be published; a let or withdrawn listing is final', () => {
  assert.deepEqual(ALLOWED.publish, ['draft']);
  for (const a of Object.values(ALLOWED)) { assert.ok(!a.includes('let')); assert.ok(!a.includes('withdrawn')); }
});

test('phaseOf: fine before 14 days, reminder from 14, hidden from 21', () => {
  const now = new Date('2026-12-01T12:00:00Z'); const ago = (d: number) => new Date(now.getTime() - d * 86_400_000 + 1000);
  assert.equal(phaseOf(ago(13), now), 'ok');
  assert.equal(phaseOf(new Date(now.getTime() - 14 * 86_400_000), now), 'remind');
  assert.equal(phaseOf(ago(20), now), 'remind');
  assert.equal(phaseOf(new Date(now.getTime() - 21 * 86_400_000), now), 'hide');
});
