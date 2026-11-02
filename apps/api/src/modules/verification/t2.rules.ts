// Pure rules for the T2 (video and location) check. Nothing here touches the database.
// The hints are arithmetic shown to a human reviewer. They never approve or reject anything.
import { randomInt } from 'crypto';

export const T2_DEADLINE_WORKING_DAYS = 3;
export const CHALLENGE_MINUTES = 30;
export const MAX_TAKES = 3;
export const UPLOAD_GRACE_MINUTES = 15;          // the database allows a submission this long after the window closes (slow networks)
export const NEAR_BASE_M = 100;                  // looks right within this distance plus the phone's own accuracy figure...
export const ACCURACY_CAP_M = 100;               // ...where the accuracy credited is capped at this
export const FAR_M = 300;                        // beyond this the reading is flagged strongly
export const READINGS_APART_M = 200;             // two readings of one short walkthrough further apart than this (plus accuracies) disagree
export const SAME_SPOT_M = 5;                    // another property's evidence this close is a copied position
export const MAX_RECORDING_SECONDS = 180;
export const KENYA = { latMin: -5.1, latMax: 5.6, lonMin: 33.5, lonMax: 42.0 } as const;

export interface Point { lat: number; lon: number }
export interface Reading extends Point { accuracyM: number; at: Date }

/** Great-circle distance in metres. */
export function haversineM(a: Point, b: Point): number {
  const R = 6_371_000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** How many units the manager must show: one for up to 10 active units, two above that. */
export const unitsToShow = (activeUnits: number) => (activeUnits > 10 ? 2 : 1);

/** A four-digit code, zeros included. `rand` is injectable for tests. */
export function newCode(rand: (maxExclusive: number) => number = (n) => randomInt(n)): string {
  return String(rand(10_000)).padStart(4, '0');
}

/** Picks distinct units at random (partial Fisher-Yates). */
export function pickUnits(ids: readonly string[], count: number, rand: (maxExclusive: number) => number = (n) => randomInt(n)): string[] {
  if (count < 1 || count > ids.length) throw new Error('not enough units to choose from');
  const a = [...ids];
  for (let i = 0; i < count; i++) { const j = i + rand(a.length - i); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, count);
}

/** The challenge request must carry an explicit yes to the notice. Anything else is refused. */
export function checkConsent(body: any): string | null {
  return body && body.consent === true ? null : 'You must agree to the video and location notice first.';
}

const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
function reading(label: string, raw: any, errors: string[]): Reading | null {
  if (!raw || typeof raw !== 'object') { errors.push(`${label} reading is required`); return null; }
  const { lat, lon, accuracyM, at } = raw;
  if (!num(lat) || lat < KENYA.latMin || lat > KENYA.latMax) { errors.push(`${label} latitude must be inside Kenya`); return null; }
  if (!num(lon) || lon < KENYA.lonMin || lon > KENYA.lonMax) { errors.push(`${label} longitude must be inside Kenya`); return null; }
  if (!num(accuracyM) || accuracyM < 0 || accuracyM > 100_000) { errors.push(`${label} accuracy must be a number of metres`); return null; }
  const when = typeof at === 'string' ? new Date(at) : null;
  if (!when || Number.isNaN(when.getTime())) { errors.push(`${label} time must be a valid date and time`); return null; }
  return { lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6, accuracyM: Math.round(accuracyM * 10) / 10, at: when };
}

/** Both location readings of one recording: right shape, inside Kenya, in order, not from the future. */
export function checkReadings(body: any, now: Date = new Date()): { start?: Reading; end?: Reading; errors: string[] } {
  const errors: string[] = [];
  const start = reading('start', body?.start, errors), end = reading('end', body?.end, errors);
  if (!start || !end) return { errors };
  if (end.at.getTime() < start.at.getTime()) errors.push('the end reading cannot be before the start reading');
  else if (end.at.getTime() - start.at.getTime() > MAX_RECORDING_SECONDS * 1000) errors.push('the two readings must be within 3 minutes of each other');
  if (end.at.getTime() > now.getTime() + 2 * 60_000) errors.push('a reading cannot be from the future');
  return errors.length ? { errors } : { start, end, errors };
}

export type DistanceBand = 'near' | 'far' | 'very_far';
/** Within 100 m plus the phone's accuracy (credited up to 100 m) is near; beyond 300 m is very far. */
export function distanceBand(distanceM: number, accuracyM: number): { band: DistanceBand; allowedM: number } {
  const allowedM = NEAR_BASE_M + Math.min(Math.max(accuracyM, 0), ACCURACY_CAP_M);
  return { band: distanceM <= allowedM ? 'near' : distanceM > Math.max(FAR_M, allowedM) ? 'very_far' : 'far', allowedM };
}

const to5 = (n: number) => Math.round(n * 1e5) / 1e5;

export interface HintInput {
  pin: Point; start: Reading; end: Reading;
  challenge: { issuedAt: Date; expiresAt: Date }; submittedAt: Date;
  sameVideoElsewhere: number;            // other submissions with the same file fingerprint
  samePlaceOtherProperties: number;      // other properties with evidence recorded within SAME_SPOT_M of these readings
}
export interface Hints {
  startDistanceM: number; endDistanceM: number; startBand: DistanceBand; endBand: DistanceBand; readingsApartM: number;
  startAfterIssueSec: number; endedBeforeExpiry: boolean; submittedAfterExpirySec: number;
  flags: string[];
}

export const HINT_FLAGS = ['location_far', 'location_very_far', 'readings_disagree', 'reading_equals_pin', 'video_reused', 'same_place_other_property', 'submitted_after_window'] as const;

/** Advice for the reviewer. `flags` lists what deserves a second look; an empty list proves nothing either way. */
export function computeHints(i: HintInput): Hints {
  const sd = haversineM(i.pin, i.start), ed = haversineM(i.pin, i.end);
  const sb = distanceBand(sd, i.start.accuracyM), eb = distanceBand(ed, i.end.accuracyM);
  const apart = haversineM(i.start, i.end);
  const flags: string[] = [];
  if (sb.band === 'very_far' || eb.band === 'very_far') flags.push('location_very_far');
  else if (sb.band === 'far' || eb.band === 'far') flags.push('location_far');
  if (apart > READINGS_APART_M + Math.min(i.start.accuracyM, ACCURACY_CAP_M) + Math.min(i.end.accuracyM, ACCURACY_CAP_M)) flags.push('readings_disagree');
  if ((to5(i.start.lat) === to5(i.pin.lat) && to5(i.start.lon) === to5(i.pin.lon)) || (to5(i.end.lat) === to5(i.pin.lat) && to5(i.end.lon) === to5(i.pin.lon))) flags.push('reading_equals_pin');
  if (i.sameVideoElsewhere > 0) flags.push('video_reused');
  if (i.samePlaceOtherProperties > 0) flags.push('same_place_other_property');
  const afterExpiry = Math.round((i.submittedAt.getTime() - i.challenge.expiresAt.getTime()) / 1000);
  if (afterExpiry > 0) flags.push('submitted_after_window');
  return {
    startDistanceM: Math.round(sd), endDistanceM: Math.round(ed), startBand: sb.band, endBand: eb.band, readingsApartM: Math.round(apart),
    startAfterIssueSec: Math.round((i.start.at.getTime() - i.challenge.issuedAt.getTime()) / 1000),
    endedBeforeExpiry: i.end.at.getTime() <= i.challenge.expiresAt.getTime(), submittedAfterExpirySec: Math.max(afterExpiry, 0), flags,
  };
}

/** Case-level flags for the queue: the hint flags plus the original T1-style context passed in by the caller. */
export const t2QueueFlags = (hints: Hints, extra: string[]) => ['t2', ...extra, ...hints.flags];

export interface TakeRequestCheck { mimeType: string; sizeBytes: number }

/** Real property videos stay switched off until legal clearance: the feature is off unless T2_ENABLED=true is set on purpose. */
export const t2Enabled = (env: NodeJS.ProcessEnv = process.env) => env.T2_ENABLED === 'true';
