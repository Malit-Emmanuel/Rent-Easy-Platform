import test from 'node:test';
import assert from 'node:assert/strict';
import { readPosition } from './position';

test('both empty means no position', () => assert.deepEqual(readPosition(' ', ''), { ok: true, value: null }));
test('both filled gives numbers', () => assert.deepEqual(readPosition('-1.2921', ' 36.7872 '), { ok: true, value: { latitude: -1.2921, longitude: 36.7872 } }));
test('one empty is an error', () => { assert.deepEqual(readPosition('-1.29', ''), { ok: false, error: 'positionBoth' }); assert.deepEqual(readPosition('', '36.8'), { ok: false, error: 'positionBoth' }); });
test('non-numbers are an error', () => assert.deepEqual(readPosition('abc', '36.8'), { ok: false, error: 'numbersOnly' }));
