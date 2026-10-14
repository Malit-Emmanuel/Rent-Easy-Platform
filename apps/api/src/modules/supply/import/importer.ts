import { parseCsv } from './csv';
import { checkProperty, checkUnit } from '../supply.validation';

// Turns a spreadsheet into a plan: which properties and units would be created, and exactly what is wrong on which row.
// Pure code: no database. The service adds "already exists" checks on top.
export type Field = 'property' | 'address' | 'node' | 'latitude' | 'longitude' | 'unit' | 'bedrooms';
export interface RowIssue { row: number; column?: string; severity: 'error' | 'warning'; code: string; message: string }
export interface PlannedUnit { row: number; label: string; bedrooms: number; exists?: boolean }
export interface PlannedProperty { key: string; firstRow: number; name: string; addressText: string; nodeId?: number | null; latitude?: number; longitude?: number; units: PlannedUnit[]; exists?: boolean }
export interface ImportPlan {
  properties: PlannedProperty[]; issues: RowIssue[];
  headerMap: Record<string, Field>; unmappedHeaders: string[];
  counts: { rows: number; properties: number; units: number; errors: number; warnings: number };
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');
const ALIASES: Record<Field, string[]> = {
  property: ['property', 'propertyname', 'building', 'buildingname', 'estate', 'apartment', 'apartments', 'plot', 'block', 'project'],
  address: ['address', 'streetaddress', 'location', 'street', 'road', 'addresstext'],
  node: ['area', 'node', 'neighbourhood', 'neighborhood', 'zone', 'estatearea'],
  latitude: ['latitude', 'lat'],
  longitude: ['longitude', 'lon', 'lng', 'long'],
  unit: ['unit', 'unitlabel', 'unitno', 'unitnumber', 'unitname', 'house', 'houseno', 'housenumber', 'flat', 'flatno', 'door', 'doorno', 'apt', 'aptno'],
  bedrooms: ['bedrooms', 'bedroom', 'beds', 'bed', 'br', 'bedroomcount', 'type', 'unittype', 'housetype'],
};
const NUMBER_WORDS: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

/** "2", "2 BR", "2BR", "Two bedroom", "bedsitter", "studio" -> number of bedrooms; null if it cannot be understood. */
export function parseBedrooms(raw: string): number | null {
  const s = raw.toLowerCase().trim();
  if (!s) return null;
  if (/\b(bedsitter|bedsit|studio|single room|bed-sitter)\b/.test(s)) return 0;
  const digits = s.match(/^(\d{1,2})\s*(br|bd|bdrm|bed|beds|bedroom|bedrooms)?\b/);
  if (digits) return Number(digits[1]);
  const word = s.match(/^(zero|one|two|three|four|five|six)\b/);
  if (word) return NUMBER_WORDS[word[1]];
  return null;
}
const parseNum = (s: string): number | null => {
  const t = s.trim().replace(/\u2212/g, '-');
  if (!t) return null;
  const v = /^-?\d+,\d+$/.test(t) ? t.replace(',', '.') : t;   // some sheets use a decimal comma
  return /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : NaN;
};

export function planImport(csvText: string, nodes: { id: number; name: string }[]): ImportPlan {
  const issues: RowIssue[] = []; const empty = (): ImportPlan => ({ properties: [], issues, headerMap: {}, unmappedHeaders: [], counts: { rows: 0, properties: 0, units: 0, errors: issues.filter((i) => i.severity === 'error').length, warnings: 0 } });
  const csv = parseCsv(csvText);
  for (const e of csv.fileErrors) issues.push({ row: 0, severity: 'error', code: 'file', message: e });
  if (!csv.headers.length) return empty();

  // Map each column to a field by its (messy) header name. First match wins.
  const headerMap: Record<string, Field> = {}; const colOf: Partial<Record<Field, number>> = {}; const unmapped: string[] = [];
  csv.headers.forEach((h, i) => {
    const field = (Object.keys(ALIASES) as Field[]).find((f) => ALIASES[f].includes(norm(h)) && colOf[f] === undefined);
    if (field) { colOf[field] = i; headerMap[h] = field; } else unmapped.push(h);
  });
  for (const must of ['property', 'unit', 'bedrooms'] as Field[]) if (colOf[must] === undefined) issues.push({ row: 1, severity: 'error', code: 'missing_column', column: must, message: `No column found for "${must}". Rename a column to one of: ${ALIASES[must].slice(0, 5).join(', ')}.` });
  if (colOf.address === undefined) issues.push({ row: 1, severity: 'error', code: 'missing_column', column: 'address', message: `No column found for "address". Rename a column to one of: ${ALIASES.address.slice(0, 4).join(', ')}.` });
  if (issues.some((i) => i.code === 'missing_column')) return { ...empty(), headerMap, unmappedHeaders: unmapped };

  const get = (r: string[], f: Field) => (colOf[f] === undefined ? '' : (r[colOf[f]!] ?? ''));
  const nodeByName = new Map(nodes.map((n) => [n.name.toLowerCase().trim(), n.id]));
  const groups = new Map<string, PlannedProperty>(); const seenUnits = new Map<string, number>();
  const add = (row: number, severity: 'error' | 'warning', code: string, message: string, column?: string) => issues.push({ row, severity, code, message, column });

  csv.rows.forEach((r, idx) => {
    const row = idx + 2;                                    // header is row 1, like the spreadsheet shows it
    const name = get(r, 'property').replace(/\s+/g, ' ').trim(), address = get(r, 'address').replace(/\s+/g, ' ').trim(), label = get(r, 'unit').replace(/\s+/g, ' ').trim();
    let ok = true;
    const bed = parseBedrooms(get(r, 'bedrooms'));
    if (!name) { add(row, 'error', 'missing', 'Property name is empty.', 'property'); ok = false; }
    if (!address) { add(row, 'error', 'missing', 'Address is empty.', 'address'); ok = false; }
    if (!label) { add(row, 'error', 'missing', 'Unit label is empty.', 'unit'); ok = false; }
    if (bed === null) { add(row, 'error', 'bedrooms', `Cannot understand bedrooms "${get(r, 'bedrooms')}". Use a number, or "bedsitter" / "studio" for 0.`, 'bedrooms'); ok = false; }
    if (!ok) return;

    const pc = checkProperty({ name, addressText: address }, 'create'); for (const e of pc.errors) { add(row, 'error', 'invalid', e); ok = false; }
    const uc = checkUnit({ label, bedrooms: bed }, 'create'); for (const e of uc.errors) { add(row, 'error', 'invalid', e, 'unit'); ok = false; }

    const la = parseNum(get(r, 'latitude')), lo = parseNum(get(r, 'longitude'));
    let pos: { latitude: number; longitude: number } | undefined;
    if (la !== null || lo !== null) {
      if (la === null || lo === null) { add(row, 'error', 'position', 'Give both latitude and longitude, or leave both empty.', 'latitude'); ok = false; }
      else if (Number.isNaN(la) || Number.isNaN(lo)) { add(row, 'error', 'position', 'Latitude and longitude must be numbers.', 'latitude'); ok = false; }
      else { const c = checkProperty({ latitude: la, longitude: lo }, 'update'); if (c.errors.length) { add(row, 'error', 'position', c.errors[0], 'latitude'); ok = false; } else pos = { latitude: la, longitude: lo }; }
    }
    if (!ok) return;

    const nodeRaw = get(r, 'node').trim(); let nodeId: number | null | undefined;
    if (nodeRaw) { nodeId = nodeByName.get(nodeRaw.toLowerCase()); if (nodeId === undefined) { add(row, 'warning', 'unknown_area', `Area "${nodeRaw}" is not one of the known areas, so it is left blank.`, 'node'); nodeId = null; } }

    const key = `${pc.value.name!.toLowerCase()}|${pc.value.addressText!.toLowerCase()}`;
    let p = groups.get(key);
    if (!p) { p = { key, firstRow: row, name: pc.value.name!, addressText: pc.value.addressText!, nodeId, ...(pos ?? {}), units: [] }; groups.set(key, p); }
    else {
      if (nodeId !== undefined && nodeId !== null && p.nodeId != null && p.nodeId !== nodeId) add(row, 'warning', 'conflict', `The area differs from row ${p.firstRow} for the same property. Row ${p.firstRow} is used.`, 'node');
      if (p.nodeId == null && nodeId != null) p.nodeId = nodeId;
      if (pos && p.latitude !== undefined && (p.latitude !== pos.latitude || p.longitude !== pos.longitude)) add(row, 'warning', 'conflict', `The position differs from row ${p.firstRow} for the same property. Row ${p.firstRow} is used.`, 'latitude');
      if (pos && p.latitude === undefined) Object.assign(p, pos);
    }
    const uk = `${key}|${uc.value.label!.toLowerCase()}`;
    if (seenUnits.has(uk)) { add(row, 'error', 'duplicate_unit', `Unit "${uc.value.label}" appears again for this property (first on row ${seenUnits.get(uk)}).`, 'unit'); return; }
    seenUnits.set(uk, row); p.units.push({ row, label: uc.value.label!, bedrooms: uc.value.bedrooms! });
  });

  const properties = [...groups.values()];
  const errors = issues.filter((i) => i.severity === 'error').length;
  return { properties, issues, headerMap, unmappedHeaders: unmapped, counts: { rows: csv.rows.length, properties: properties.length, units: properties.reduce((n, p) => n + p.units.length, 0), errors, warnings: issues.length - errors } };
}
