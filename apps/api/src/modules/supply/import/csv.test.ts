import test from 'node:test';
import assert from 'node:assert/strict';
import { IMPORT_LIMITS, parseCsv } from './csv';

test('plain comma file with Windows line endings and a byte-order mark', () => {
  const r = parseCsv('\uFEFFProperty,Unit\r\nPalm Court,A1\r\nPalm Court,A2\r\n');
  assert.deepEqual(r.headers, ['Property', 'Unit']); assert.deepEqual(r.rows, [['Palm Court', 'A1'], ['Palm Court', 'A2']]); assert.equal(r.delimiter, ',');
});
test('quoted values may contain commas, quotes and line breaks', () => {
  const r = parseCsv('Property,Address\n"Palm, Court","Plot 5, ""Kilimani""\nNairobi"\n');
  assert.deepEqual(r.rows, [['Palm, Court', 'Plot 5, "Kilimani"\nNairobi']]);
});
test('semicolon and tab delimited files (common in some Excel regions) are detected', () => {
  assert.equal(parseCsv('A;B;C\n1;2;3').delimiter, ';'); assert.deepEqual(parseCsv('A;B;C\n1;2;3').rows, [['1', '2', '3']]);
  assert.equal(parseCsv('A\tB\n1\t2').delimiter, '\t');
});
test('blank lines are ignored and spaces are trimmed', () => {
  assert.deepEqual(parseCsv('A,B\n\n  x , y \n,,\n').rows, [['x', 'y']]);
});
test('an unclosed quote and an empty file are reported, not guessed', () => {
  assert.ok(parseCsv('A,B\n"oops,1\n').fileErrors.some((e) => e.includes('quote')));
  assert.ok(parseCsv('').fileErrors.length > 0); assert.ok(parseCsv('\n\n').fileErrors.length > 0);
});
test('limits: too many rows and too large a file are refused with clear messages', () => {
  const many = 'A\n' + Array.from({ length: IMPORT_LIMITS.maxRows + 5 }, (_, i) => `r${i}`).join('\n');
  const r = parseCsv(many); assert.equal(r.rows.length, IMPORT_LIMITS.maxRows); assert.ok(r.fileErrors[0].includes('limit'));
  assert.ok(parseCsv('A\n' + 'x'.repeat(IMPORT_LIMITS.maxBytes + 10)).fileErrors[0].includes('2 MB'));
});
test('a delimiter inside quotes in the header does not confuse detection', () => {
  assert.equal(parseCsv('"Name, full",B\n1,2').delimiter, ',');
});
