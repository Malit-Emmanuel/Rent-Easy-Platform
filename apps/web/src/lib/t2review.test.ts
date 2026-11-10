import test from 'node:test';
import assert from 'node:assert/strict';
import { T2_QUESTIONS, T2_REASONS, T1_REASONS, allAnswered, allYes, bandTone, fmtDistance, mapLink, noCount, t2Gate } from './t2review';

const yes = Object.fromEntries(T2_QUESTIONS.map((q) => [q, true]));
test('gate: every question must be answered before any decision', () => {
  assert.equal(t2Gate('reject', {}, true, true), 'answer_all');
  assert.equal(t2Gate('reject', { ...yes, units_shown: undefined }, true, true), 'answer_all');
  assert.equal(allAnswered(yes), true); assert.equal(allYes({ ...yes, units_shown: false }), false);
});
test('gate: approve needs six yeses, the video watched and the documents opened; the other decisions do not', () => {
  assert.equal(t2Gate('approve', { ...yes, location_close: false }, true, true), 'has_no');
  assert.equal(t2Gate('approve', yes, false, true), 'watch');
  assert.equal(t2Gate('approve', yes, true, false), 'docs');
  assert.equal(t2Gate('approve', yes, true, true), 'ok');
  assert.equal(t2Gate('reject', { ...yes, location_close: false }, false, false), 'ok');
  assert.equal(t2Gate('needs_changes', yes, false, false), 'ok');
  assert.equal(noCount({ ...yes, units_shown: false, location_close: false }), 2);
});
test('reasons: T2 cases offer the video reasons, T1 cases never do', () => {
  assert.ok(T2_REASONS.includes('t2_suspected_replay')); assert.ok(!T2_REASONS.includes('doc_expired' as never));
  assert.ok(T1_REASONS.every((r) => !r.startsWith('t2_')));
});
test('distance and map link formatting', () => {
  assert.equal(fmtDistance(22), '22 m'); assert.equal(fmtDistance(849.6), '850 m'); assert.equal(fmtDistance(3400), '3.4 km'); assert.equal(fmtDistance(22000), '22 km'); assert.equal(fmtDistance(null), '–');
  assert.match(mapLink(-1.2921, 36.8219), /mlat=-1\.292100&mlon=36\.821900#map=18/);
  assert.equal(bandTone('near'), 'ok'); assert.equal(bandTone('far'), 'wait'); assert.equal(bandTone('very_far'), 'bad'); assert.equal(bandTone(null), 'ok');
});
