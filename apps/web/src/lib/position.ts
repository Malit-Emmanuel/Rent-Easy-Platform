/** Turns the two position text boxes into the API shape. Both empty = no position; one empty = error. */
export function readPosition(lat: string, lon: string): { ok: true; value: { latitude: number; longitude: number } | null } | { ok: false; error: 'positionBoth' | 'numbersOnly' } {
  const a = lat.trim(), b = lon.trim();
  if (!a && !b) return { ok: true, value: null };
  if (!a || !b) return { ok: false, error: 'positionBoth' };
  const latitude = Number(a), longitude = Number(b);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return { ok: false, error: 'numbersOnly' };
  return { ok: true, value: { latitude, longitude } };
}
