import test from 'node:test';
import assert from 'node:assert/strict';
import { currentMonth, figureEntries, fmtKes, fmtNum, fmtPct, monthOptions, parseAmount, shiftMonth, shortId } from './oversight';

test('the current month is the Kenyan calendar month', () => {
  assert.equal(currentMonth(new Date('2026-11-30T21:30:00Z')), '2026-12');   // 00:30 on 1 December in Nairobi
  assert.equal(currentMonth(new Date('2026-11-30T20:59:00Z')), '2026-11');
});
test('shifting months crosses years both ways', () => {
  assert.equal(shiftMonth('2026-01', -1), '2025-12'); assert.equal(shiftMonth('2026-12', 1), '2027-01'); assert.equal(shiftMonth('2026-05', 0), '2026-05'); assert.equal(shiftMonth('2026-03', -14), '2025-01');
});
test('month options are newest first and stop at January 2024', () => {
  const o = monthOptions(new Date('2026-11-10T12:00:00Z'), 3); assert.deepEqual(o, ['2026-11', '2026-10', '2026-09']);
  const e = monthOptions(new Date('2024-02-10T12:00:00Z'), 12); assert.deepEqual(e, ['2024-02', '2024-01']);
});
test('money and numbers read plainly, and missing values are a dash', () => {
  assert.equal(fmtKes(1234567.5), 'KES 1,234,567.50'); assert.equal(fmtKes(500), 'KES 500'); assert.equal(fmtKes(0), 'KES 0'); assert.equal(fmtKes(null), '—'); assert.equal(fmtKes(NaN), '—'); assert.equal(fmtKes(-20), '-KES 20');
  assert.equal(fmtNum(12.345), '12.3'); assert.equal(fmtNum(null), '—'); assert.equal(fmtPct(62.5), '62.5%'); assert.equal(fmtPct(null), '—'); assert.equal(fmtNum(7, 2), '7');
});
test('an amount box accepts normal money and refuses everything else', () => {
  assert.equal(parseAmount('1,500.50'), 1500.5); assert.equal(parseAmount(' 600 '), 600); assert.equal(parseAmount('0'), 0);
  for (const bad of ['', 'abc', '-5', '1.234', '1e3', '5 000', '1000000001', '.5']) assert.equal(parseAmount(bad), null, bad);
});
test('alert figures hide identifiers and lists', () => {
  const e = figureEntries({ decisions: 25, approvalRatePct: 100, orgId: 'x', flags: ['a'], startedAt: '2026-01-01', thresholdHours: 4, note: 'text', nested: { a: 1 } });
  assert.deepEqual(e, [{ key: 'decisions', value: '25' }, { key: 'approvalRatePct', value: '100' }, { key: 'note', value: 'text' }]);
  assert.deepEqual(figureEntries(null), []);
});
test('a case number is eight characters', () => { assert.equal(shortId('12345678-aaaa-bbbb-cccc-dddddddddddd'), '12345678'); });
