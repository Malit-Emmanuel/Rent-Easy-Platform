import test from 'node:test';
import assert from 'node:assert/strict';
import { addWorkingDays, badgeValid, canAppeal, missingProof, riskFlags } from './cases.rules';

const d = (s: string) => new Date(s);

test('working days skip weekends', () => {
  assert.equal(addWorkingDays(d('2026-10-26T09:00:00Z'), 2).toISOString(), '2026-10-28T09:00:00.000Z');   // Mon -> Wed
  assert.equal(addWorkingDays(d('2026-10-29T09:00:00Z'), 2).toISOString(), '2026-11-02T09:00:00.000Z');   // Thu -> Mon
  assert.equal(addWorkingDays(d('2026-10-30T15:00:00Z'), 2).toISOString(), '2026-11-03T15:00:00.000Z');   // Fri -> Tue
  assert.equal(addWorkingDays(d('2026-10-31T10:00:00Z'), 2).toISOString(), '2026-11-03T10:00:00.000Z');   // Sat -> Tue
});

test('placeholder proof rules: deed or lease, plus a letter of authority unless the organisation is the landlord', () => {
  assert.deepEqual(missingProof([], 'agency'), ['title_deed_or_lease', 'management_authorisation']);
  assert.deepEqual(missingProof(['title_deed'], 'agency'), ['management_authorisation']);
  assert.deepEqual(missingProof(['lease_agreement', 'management_authorisation'], 'management_firm'), []);
  assert.deepEqual(missingProof(['title_deed'], 'landlord'), []);
  assert.deepEqual(missingProof(['other'], 'landlord'), ['title_deed_or_lease']);
});

test('risk flags are simple and only describe', () => {
  const base = { orgAgeDays: 90, priorRejections: 0, docTypes: ['title_deed'], newestDocAgeMinutes: 500, isAppeal: false };
  assert.deepEqual(riskFlags(base), []);
  assert.deepEqual(riskFlags({ ...base, orgAgeDays: 3, priorRejections: 1, docTypes: ['lease_agreement'], newestDocAgeMinutes: 5, isAppeal: true }),
    ['new_organisation', 'previously_rejected', 'lease_only', 'fresh_upload', 'appeal']);
});

test('appeals: rejected, inside 14 days, once, and never an appeal of an appeal', () => {
  const now = d('2026-11-01T00:00:00Z'), base = { status: 'rejected', decidedAt: d('2026-10-25T00:00:00Z'), appealOf: null, hasAppeal: false };
  assert.equal(canAppeal(base, now), true);
  assert.equal(canAppeal({ ...base, decidedAt: d('2026-10-10T00:00:00Z') }, now), false);
  assert.equal(canAppeal({ ...base, hasAppeal: true }, now), false);
  assert.equal(canAppeal({ ...base, appealOf: 'x' }, now), false);
  assert.equal(canAppeal({ ...base, status: 'approved' }, now), false);
});

test('expired and revoked badges never count', () => {
  const now = d('2026-11-01T00:00:00Z');
  assert.equal(badgeValid({ expiresAt: d('2027-01-01T00:00:00Z'), revokedAt: null }, now), true);
  assert.equal(badgeValid({ expiresAt: d('2026-10-31T00:00:00Z'), revokedAt: null }, now), false);
  assert.equal(badgeValid({ expiresAt: d('2027-01-01T00:00:00Z'), revokedAt: d('2026-10-30T00:00:00Z') }, now), false);
  assert.equal(badgeValid(null, now), false);
});
