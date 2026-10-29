import test from 'node:test';
import assert from 'node:assert/strict';
import { span } from './span';

test('span shows days and hours, hours and minutes, or minutes', () => {
  assert.equal(span(2 * 1440 + 3 * 60 + 5), '2d 3h');
  assert.equal(span(5 * 60 + 10), '5h 10m');
  assert.equal(span(40), '40m');
  assert.equal(span(-185), '3h 5m');
});
