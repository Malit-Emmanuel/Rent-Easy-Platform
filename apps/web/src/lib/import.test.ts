import test from 'node:test';
import assert from 'node:assert/strict';
import { commitError, fileProblem, orderIssues } from './import';

test('only small CSV or text files are accepted', () => {
  assert.equal(fileProblem('units.csv', 1000), null); assert.equal(fileProblem('UNITS.CSV', 1000), null); assert.equal(fileProblem('notes.txt', 10), null);
  assert.equal(fileProblem('units.xlsx', 1000), 'err_notCsv'); assert.equal(fileProblem('units.csv.exe', 10), 'err_notCsv'); assert.equal(fileProblem('units', 10), 'err_notCsv');
  assert.equal(fileProblem('units.csv', 2 * 1024 * 1024 + 1), 'err_fileTooBig'); assert.equal(fileProblem('units.csv', 2 * 1024 * 1024), null);
});
test('errors come before warnings, each in row order', () => {
  const o = orderIssues([{ row: 5, severity: 'warning', code: 'w', message: '' }, { row: 9, severity: 'error', code: 'e', message: '' }, { row: 2, severity: 'warning', code: 'w', message: '' }, { row: 3, severity: 'error', code: 'e', message: '' }]);
  assert.deepEqual(o.map((i) => `${i.severity[0]}${i.row}`), ['e3', 'e9', 'w2', 'w5']);
});
test('confirm errors map to clear messages', () => {
  assert.equal(commitError(409), 'err_importState'); assert.equal(commitError(429), 'tooMany'); assert.equal(commitError(500), 'importFailed');
});
