import test from 'node:test';
import assert from 'node:assert/strict';
import { checkConsent, checkReadings, computeHints, distanceBand, haversineM, newCode, pickUnits, unitsToShow } from './t2.rules';

const PIN = { lat: -1.2921, lon: 36.8219 };
const t0 = new Date('2026-11-02T10:00:00Z');
const at = (s: number) => new Date(t0.getTime() + s * 1000);
const rd = (lat: number, lon: number, accuracyM = 10, s = 60) => ({ lat, lon, accuracyM, at: at(s) });
const base = { pin: PIN, challenge: { issuedAt: t0, expiresAt: at(1800) }, submittedAt: at(300), sameVideoElsewhere: 0, samePlaceOtherProperties: 0 };

test('haversine: known distances', () => {
  assert.equal(Math.round(haversineM(PIN, PIN)), 0);
  assert.ok(Math.abs(haversineM({ lat: 0, lon: 0 }, { lat: 0, lon: 1 }) - 111_195) < 300);       // one degree of longitude at the equator
  assert.ok(Math.abs(haversineM({ lat: -1.2921, lon: 36.8219 }, { lat: -1.2921 + 0.0009, lon: 36.8219 }) - 100) < 2);
});

test('units to show: one up to 10 units, two above', () => {
  assert.deepEqual([1, 5, 10, 11, 40].map(unitsToShow), [1, 1, 1, 2, 2]);
});

test('codes are four digits with zeros kept; unit picks are distinct and come from the list', () => {
  assert.equal(newCode(() => 7), '0007'); assert.equal(newCode(() => 9999), '9999');
  for (let i = 0; i < 200; i++) assert.match(newCode(), /^\d{4}$/);
  const ids = ['a', 'b', 'c', 'd', 'e'];
  for (let i = 0; i < 100; i++) { const p = pickUnits(ids, 2); assert.equal(new Set(p).size, 2); assert.ok(p.every((x) => ids.includes(x))); }
  assert.deepEqual(pickUnits(['only'], 1), ['only']);
  assert.throws(() => pickUnits(['a'], 2)); assert.throws(() => pickUnits(['a'], 0));
  const seen = new Set<string>(); for (let i = 0; i < 300; i++) seen.add(pickUnits(ids, 1)[0]); assert.equal(seen.size, 5, 'every unit can be chosen');
});

test('consent must be an explicit true', () => {
  assert.equal(checkConsent({ consent: true }), null);
  for (const b of [undefined, null, {}, { consent: 'true' }, { consent: 1 }, { consent: false }]) assert.ok(checkConsent(b));
});

test('readings: shape, Kenya box, order, 3-minute span, no future times', () => {
  const ok = { start: { lat: -1.29, lon: 36.82, accuracyM: 12.34, at: at(10).toISOString() }, end: { lat: -1.2901, lon: 36.8201, accuracyM: 8, at: at(70).toISOString() } };
  const r = checkReadings(ok, at(100)); assert.deepEqual(r.errors, []); assert.equal(r.start!.accuracyM, 12.3);
  const bad = (m: (b: any) => void, now = at(100)) => { const b = JSON.parse(JSON.stringify(ok)); m(b); return checkReadings(b, now).errors.length > 0; };
  assert.ok(checkReadings(undefined).errors.length); assert.ok(checkReadings({}).errors.length);
  assert.ok(bad((b) => { b.start.lat = 51.5; })); assert.ok(bad((b) => { b.end.lon = 20; }));
  assert.ok(bad((b) => { b.start.lat = '1'; })); assert.ok(bad((b) => { b.start.accuracyM = -1; })); assert.ok(bad((b) => { b.end.accuracyM = NaN; }));
  assert.ok(bad((b) => { b.start.at = 'yesterday-ish'; })); assert.ok(bad((b) => { b.end.at = at(5).toISOString(); }));
  assert.ok(bad((b) => { b.end.at = at(10 + 181).toISOString(); }, at(1000)));
  assert.ok(bad(() => {}, at(-600)), 'readings from the future');
  assert.ok(!bad((b) => { b.end.at = at(10 + 180).toISOString(); }, at(1000)), 'exactly 3 minutes is allowed');
});

test('distance band: 100 m plus phone accuracy up to 100 m; far; very far beyond 300 m', () => {
  assert.deepEqual(distanceBand(100, 0), { band: 'near', allowedM: 100 });
  assert.equal(distanceBand(140, 50).band, 'near');                // allowed 150
  assert.equal(distanceBand(190, 50).band, 'far');
  assert.equal(distanceBand(199, 5000).band, 'near');              // accuracy credit is capped at 100 m, so allowed is 200
  assert.equal(distanceBand(201, 5000).band, 'far');
  assert.equal(distanceBand(301, 10).band, 'very_far');
  assert.equal(distanceBand(250, 10).band, 'far');
});

test('hints: a clean recording has no flags', () => {
  const h = computeHints({ ...base, start: rd(PIN.lat + 0.0002, PIN.lon), end: rd(PIN.lat + 0.0003, PIN.lon + 0.0001) });
  assert.deepEqual(h.flags, []); assert.equal(h.startBand, 'near'); assert.ok(h.startDistanceM > 15 && h.startDistanceM < 30);
  assert.equal(h.endedBeforeExpiry, true); assert.equal(h.submittedAfterExpirySec, 0); assert.equal(h.startAfterIssueSec, 60);
});

test('hints: far and very far readings', () => {
  const far = computeHints({ ...base, start: rd(PIN.lat + 0.0022, PIN.lon), end: rd(PIN.lat + 0.0022, PIN.lon) });   // ~245 m
  assert.deepEqual(far.flags, ['location_far']);
  const very = computeHints({ ...base, start: rd(PIN.lat + 0.01, PIN.lon), end: rd(PIN.lat + 0.01, PIN.lon) });      // ~1.1 km
  assert.deepEqual(very.flags, ['location_very_far']);
});

test('hints: readings that disagree, a reading equal to the pin, a reused video, a copied position, a late submission', () => {
  assert.ok(computeHints({ ...base, start: rd(PIN.lat + 0.0005, PIN.lon), end: rd(PIN.lat - 0.0025, PIN.lon) }).flags.includes('readings_disagree'));
  assert.ok(computeHints({ ...base, start: rd(PIN.lat, PIN.lon), end: rd(PIN.lat + 0.0003, PIN.lon) }).flags.includes('reading_equals_pin'));
  assert.ok(computeHints({ ...base, start: rd(PIN.lat + 0.000004, PIN.lon), end: rd(PIN.lat + 0.0003, PIN.lon) }).flags.includes('reading_equals_pin'), 'equal after rounding to 5 decimals');
  assert.ok(!computeHints({ ...base, start: rd(PIN.lat + 0.0001, PIN.lon), end: rd(PIN.lat + 0.0003, PIN.lon) }).flags.includes('reading_equals_pin'));
  const clean = { start: rd(PIN.lat + 0.0002, PIN.lon), end: rd(PIN.lat + 0.0003, PIN.lon) };
  assert.deepEqual(computeHints({ ...base, ...clean, sameVideoElsewhere: 1 }).flags, ['video_reused']);
  assert.deepEqual(computeHints({ ...base, ...clean, samePlaceOtherProperties: 2 }).flags, ['same_place_other_property']);
  const late = computeHints({ ...base, ...clean, submittedAt: at(1800 + 400) });
  assert.deepEqual(late.flags, ['submitted_after_window']); assert.equal(late.submittedAfterExpirySec, 400);
});

test('hints never carry a decision', () => {
  const h = computeHints({ ...base, start: rd(PIN.lat + 0.05, PIN.lon), end: rd(PIN.lat + 0.05, PIN.lon), sameVideoElsewhere: 3 });
  assert.ok(h.flags.length >= 2);
  for (const k of Object.keys(h)) assert.ok(!/approve|reject|pass|fail|decision/i.test(k), k);
});

import { T2_CHECKLIST, T2_REASON_CODES, checkT2Decision, t2BadgeExpiry } from './t2.rules';

test('T2 decision: six checklist answers always; approve needs six yeses; others need a reason', () => {
  const yes = Object.fromEntries(T2_CHECKLIST.map((k) => [k, true]));
  const oneNo = { ...yes, location_close: false };
  assert.equal(checkT2Decision({ decision: 'approve', checklist: yes }).error, null);
  assert.deepEqual(checkT2Decision({ decision: 'approve', checklist: yes }).checklist, yes);
  assert.ok(checkT2Decision({ decision: 'approve', checklist: oneNo }).error, 'a no blocks an approval');
  assert.ok(checkT2Decision({ decision: 'approve' }).error, 'no checklist');
  assert.ok(checkT2Decision({ decision: 'approve', checklist: { ...yes, code_heard: 'yes' } }).error, 'answers must be true or false');
  assert.ok(checkT2Decision({ decision: 'approve', checklist: { code_heard: true } }).error, 'missing items');
  assert.ok(checkT2Decision({ decision: 'approve', checklist: { ...yes, extra: true } }).error, 'unknown item');
  assert.ok(checkT2Decision({ decision: 'approve', checklist: yes, reasonCode: 't2_code_missing' }).error, 'approval has no reason');
  assert.ok(checkT2Decision({ decision: 'reject', checklist: oneNo }).error, 'reject needs a reason');
  assert.equal(checkT2Decision({ decision: 'reject', checklist: oneNo, reasonCode: 't2_location_mismatch' }).error, null);
  assert.equal(checkT2Decision({ decision: 'needs_changes', checklist: yes, reasonCode: 't2_video_unusable' }).error, null, 'a reviewer may ask for changes even with six yeses');
  assert.equal(checkT2Decision({ decision: 'reject', checklist: oneNo, reasonCode: 'suspected_forgery' }).error, null);
  assert.ok(checkT2Decision({ decision: 'reject', checklist: oneNo, reasonCode: 'doc_expired' }).error, 'document-only reasons do not apply to a video');
  assert.ok(checkT2Decision({ decision: 'reject', checklist: oneNo, reasonCode: 'other' }).error, 'other needs a note');
  assert.equal(checkT2Decision({ decision: 'reject', checklist: oneNo, reasonCode: 'other', note: 'Filmed a screen' }).error, null);
  assert.ok(checkT2Decision({ decision: 'reject', checklist: oneNo, reasonCode: 't2_code_missing', note: 'x'.repeat(501) }).error);
  assert.ok(checkT2Decision({ decision: 'maybe', checklist: yes }).error);
});

test('T2 badge lasts six calendar months, never beyond the database limit of 186 days', () => {
  assert.equal(t2BadgeExpiry(new Date('2026-11-07T10:00:00Z')).toISOString(), '2027-05-07T10:00:00.000Z');
  for (const d of ['2026-01-31', '2026-08-31', '2027-12-31', '2028-02-29']) {
    const from = new Date(d + 'T00:00:00Z'); const days = (t2BadgeExpiry(from).getTime() - from.getTime()) / 86_400_000;
    assert.ok(days > 170 && days <= 186, `${d}: ${days}`);
  }
});

import { checkRevoke as checkRevokeS5e } from './cases.rules';
test('withdrawing a video badge accepts only video reasons', () => {
  assert.equal(checkRevokeS5e({ reasonCode: 't2_suspected_replay' }, T2_REASON_CODES), null);
  assert.match(checkRevokeS5e({ reasonCode: 'doc_expired' }, T2_REASON_CODES) ?? '', /valid reason/);
  assert.match(checkRevokeS5e({ reasonCode: 'other' }, T2_REASON_CODES) ?? '', /note/);
  assert.equal(checkRevokeS5e({ reasonCode: 'doc_expired' }), null, 'T1 default list unchanged');
});
