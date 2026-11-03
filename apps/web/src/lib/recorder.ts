// Browser-side helpers for the T2 walkthrough. The server is the authority on every rule; these only guide the person and avoid wasted uploads.
export const MIN_SECONDS = 30;
export const MAX_SECONDS = 90;
export const VIDEO_BPS = 1_000_000;           // about 7.5 MB a minute for the picture...
export const AUDIO_BPS = 64_000;              // ...plus a little for sound: a 90-second take is roughly 12 MB, far below the 45 MB limit
export const MAX_BYTES = 45 * 1024 * 1024;

const CANDIDATES = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];

/** The best recording format this browser supports, or null if it cannot record at all. Safari gives MP4, Chrome gives WebM. */
export function pickMime(isSupported: (mime: string) => boolean): string | null {
  return CANDIDATES.find((m) => { try { return isSupported(m); } catch { return false; } }) ?? null;
}

/** "video/webm;codecs=vp9,opus" becomes "video/webm": the server knows only the plain types. */
export const baseMime = (m: string) => m.split(';')[0].trim().toLowerCase();

/** The in-app browsers of social apps often cannot record. The page tells people to open it in Chrome or Safari instead. */
export function inAppBrowser(ua: string): boolean {
  return /FBAN|FBAV|FB_IAB|Instagram|WhatsApp|Line\/|MicroMessenger|musical_ly|TikTok|BytedanceWebview|Snapchat|Twitter|LinkedInApp/i.test(ua);
}

/** How far the phone's clock is from the server's, so readings are stamped on the server's timeline. */
export const clockSkewMs = (serverNowIso: string, deviceNowMs: number) => {
  const s = new Date(serverNowIso).getTime();
  return Number.isFinite(s) ? s - deviceNowMs : 0;
};
export const stamp = (deviceNowMs: number, skewMs: number) => new Date(deviceNowMs + skewMs).toISOString();

export const secondsLeft = (expiresAtIso: string, nowMs: number) => Math.max(0, Math.ceil((new Date(expiresAtIso).getTime() - nowMs) / 1000));
export const fmtClock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

export type TakeCheck = 'ok' | 'too_short' | 'too_large';
/** Checks a finished recording before upload. */
export function checkTake(seconds: number, bytes: number): TakeCheck {
  if (seconds < MIN_SECONDS - 1) return 'too_short';
  if (bytes > MAX_BYTES) return 'too_large';
  return 'ok';
}

/** Maps a server answer to the i18n key of the message. */
export function t2Error(status: number, code?: string): string {
  if (code === 'id_not_verified') return 'pvIdNeeded';
  if (code === 't2_disabled') return 't2_err_disabled';
  if (code === 'challenge_expired') return 't2_err_expired';
  if (code === 'takes_used') return 't2_err_takes';
  if (code === 'recording_outside_window') return 't2_err_window';
  if (code === 'challenge_active') return 't2_err_active';
  if (code === 'upload_not_complete') return 'err_uploadFailed';
  if (status === 502) return 'err_storageDown';
  if (status === 503) return 'err_storageOff';
  if (status === 409 || status === 422) return 't2_err_refused';
  return 'genericError';
}

export const blockerKey = (code: string) => `t2_block_${code}`;

/** Why the phone could not get a location. */
export function positionError(code: number): 't2_err_locDenied' | 't2_err_locFailed' {
  return code === 1 ? 't2_err_locDenied' : 't2_err_locFailed';
}
