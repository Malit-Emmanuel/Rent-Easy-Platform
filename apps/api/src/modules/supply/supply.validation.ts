// Pure input validation for properties and units (no database, easy to test).
export const KENYA = { latMin: -5.1, latMax: 5.6, lonMin: 33.5, lonMax: 42.0 };

export interface PropertyInput { name?: string; addressText?: string; nodeId?: number | null; latitude?: number | null; longitude?: number | null }
export interface UnitInput { label?: string; bedrooms?: number; floor?: string | null }
export interface Checked<T> { value: T; errors: string[] }

const clean = (s: unknown) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : undefined);

export function checkProperty(body: any, mode: 'create' | 'update'): Checked<PropertyInput> {
  const errors: string[] = []; const v: PropertyInput = {};
  const b = body && typeof body === 'object' ? body : {};

  if (b.name !== undefined || mode === 'create') {
    const n = clean(b.name);
    if (!n || n.length < 2 || n.length > 120) errors.push('name must be 2 to 120 characters'); else v.name = n;
  }
  if (b.addressText !== undefined || mode === 'create') {
    const a = clean(b.addressText);
    if (!a || a.length < 3 || a.length > 300) errors.push('addressText must be 3 to 300 characters'); else v.addressText = a;
  }
  if (b.nodeId !== undefined) {
    if (b.nodeId === null) v.nodeId = null;
    else if (Number.isInteger(b.nodeId) && b.nodeId > 0) v.nodeId = b.nodeId;
    else errors.push('nodeId must be a positive whole number or null');
  }
  const hasLat = b.latitude !== undefined, hasLon = b.longitude !== undefined;
  if (hasLat || hasLon) {
    if (b.latitude === null && b.longitude === null) { v.latitude = null; v.longitude = null; }   // clear the position
    else if (typeof b.latitude !== 'number' || typeof b.longitude !== 'number' || !Number.isFinite(b.latitude) || !Number.isFinite(b.longitude)) {
      errors.push('latitude and longitude must both be numbers (or both null to clear)');
    } else if (b.latitude < KENYA.latMin || b.latitude > KENYA.latMax || b.longitude < KENYA.lonMin || b.longitude > KENYA.lonMax) {
      const swapped = b.longitude >= KENYA.latMin && b.longitude <= KENYA.latMax && b.latitude >= KENYA.lonMin && b.latitude <= KENYA.lonMax;
      errors.push(swapped ? 'latitude and longitude look swapped' : 'the position is outside Kenya');
    } else { v.latitude = b.latitude; v.longitude = b.longitude; }
  }
  if (mode === 'update' && !errors.length && Object.keys(v).length === 0) errors.push('nothing to update');
  return { value: v, errors };
}

export function checkUnit(body: any, mode: 'create' | 'update'): Checked<UnitInput> {
  const errors: string[] = []; const v: UnitInput = {};
  const b = body && typeof body === 'object' ? body : {};
  if (b.label !== undefined || mode === 'create') {
    const l = clean(b.label);
    if (!l || l.length > 40) errors.push('label must be 1 to 40 characters'); else v.label = l;
  }
  if (b.bedrooms !== undefined || mode === 'create') {
    if (!Number.isInteger(b.bedrooms) || b.bedrooms < 0 || b.bedrooms > 20) errors.push('bedrooms must be a whole number from 0 to 20 (0 means a bedsitter or studio)');
    else v.bedrooms = b.bedrooms;
  }
  if (b.floor !== undefined) {
    if (b.floor === null || b.floor === '') v.floor = null;
    else { const f = clean(typeof b.floor === 'number' ? String(b.floor) : b.floor); if (!f || f.length > 20) errors.push('floor must be 1 to 20 characters (or empty to clear)'); else v.floor = f; }
  }
  if (mode === 'update' && !errors.length && Object.keys(v).length === 0) errors.push('nothing to update');
  return { value: v, errors };
}

/** Query-string limit: default 100, maximum 200. */
export function pageLimit(raw: unknown): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? Math.min(n, 200) : 100;
}
