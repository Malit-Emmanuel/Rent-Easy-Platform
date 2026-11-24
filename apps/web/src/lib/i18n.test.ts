import test from 'node:test';
import assert from 'node:assert/strict';
import { dict, normaliseLang, translate } from './i18n';

test('Swahili has every English key and no extras', () => {
  assert.deepEqual(Object.keys(dict.sw).sort(), Object.keys(dict.en).sort());
});
test('no empty strings', () => {
  for (const l of ['en', 'sw'] as const) for (const [k, v] of Object.entries(dict[l])) assert.ok(v.trim(), `${l}.${k}`);
});
test('unknown languages fall back to English; unknown keys return the key', () => {
  assert.equal(normaliseLang('fr'), 'en'); assert.equal(normaliseLang('sw'), 'sw');
  assert.equal(translate('sw', 'nope'), 'nope');
});

test('sign-in messages tell people what to do next, in both languages', () => {
  for (const l of ['en', 'sw'] as const) {
    for (const k of ['badPhone', 'badCode', 'tooMany', 'codeUnavailable'] as const) assert.ok(dict[l][k].length > 40, `${l}.${k} should explain the next step`);
    assert.match(dict[l].codeSent, /6/); assert.match(dict[l].codeSentWhatsapp, /6/);
  }
});
test('getting-started steps exist with a hint each', () => {
  for (const l of ['en', 'sw'] as const) for (let i = 1; i <= 4; i++) { assert.ok(dict[l][`gsStep${i}` as keyof typeof dict.en]); assert.ok(dict[l][`gsStep${i}Hint` as keyof typeof dict.en]); }
});
