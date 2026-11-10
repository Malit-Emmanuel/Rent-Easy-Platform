// Pure helpers for the reviewer's T2 evidence panel (no browser APIs, so they are unit-tested).

export const T2_QUESTIONS = ['code_heard', 'place_matches_address', 'units_shown', 'footage_continuous', 'location_close', 'matches_documents'] as const;
export type T2Question = (typeof T2_QUESTIONS)[number];
export type Answers = Partial<Record<T2Question, boolean>>;

/** Reasons offered on a T2 case: the six video reasons, plus the two general ones. */
export const T2_REASONS = ['t2_code_missing', 't2_location_mismatch', 't2_property_mismatch', 't2_unit_not_shown', 't2_video_unusable', 't2_suspected_replay', 'suspected_forgery', 'other'] as const;
export const T1_REASONS = ['doc_unreadable', 'doc_owner_mismatch', 'doc_expired', 'authorisation_missing', 'property_mismatch', 'suspected_forgery', 'other'] as const;

export const allAnswered = (a: Answers) => T2_QUESTIONS.every((q) => typeof a[q] === 'boolean');
export const allYes = (a: Answers) => T2_QUESTIONS.every((q) => a[q] === true);
export const noCount = (a: Answers) => T2_QUESTIONS.filter((q) => a[q] === false).length;

/** The decision button state for a T2 case. Mirrors the server, which is the real gate. */
export function t2Gate(decision: 'approve' | 'needs_changes' | 'reject', a: Answers, videoOpened: boolean, docsOpened: boolean): 'ok' | 'answer_all' | 'has_no' | 'watch' | 'docs' {
  if (!allAnswered(a)) return 'answer_all';
  if (decision !== 'approve') return 'ok';
  if (!allYes(a)) return 'has_no';
  if (!videoOpened) return 'watch';
  if (!docsOpened) return 'docs';
  return 'ok';
}

/** "22 m", "850 m", "3.4 km", "22 km" */
export function fmtDistance(m: number | null | undefined): string {
  if (m === null || m === undefined || !Number.isFinite(m)) return '–';
  if (m < 1000) return `${Math.round(m)} m`;
  const km = m / 1000;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

/** Only for a link the reviewer clicks: the property position on an ordinary map. */
export const mapLink = (lat: number, lon: number) => `https://www.openstreetmap.org/?mlat=${lat.toFixed(6)}&mlon=${lon.toFixed(6)}#map=18/${lat.toFixed(6)}/${lon.toFixed(6)}`;

/** How a distance band is shown: calm for near, amber for far, red for very far. */
export const bandTone = (band: string | null | undefined): 'ok' | 'wait' | 'bad' => (band === 'very_far' ? 'bad' : band === 'far' ? 'wait' : 'ok');
