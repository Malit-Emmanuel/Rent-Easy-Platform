// A small, strict CSV reader for agent spreadsheets saved from Excel or Google Sheets. No dependencies.
export const IMPORT_LIMITS = { maxBytes: 2 * 1024 * 1024, maxRows: 2000 };
export interface CsvResult { headers: string[]; rows: string[][]; delimiter: string; fileErrors: string[] }

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''; let inQ = false; const count: Record<string, number> = { ',': 0, ';': 0, '\t': 0 };
  for (const ch of firstLine) { if (ch === '"') inQ = !inQ; else if (!inQ && ch in count) count[ch]++; }
  const best = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : ',';
}

export function parseCsv(input: string): CsvResult {
  const fileErrors: string[] = [];
  if (Buffer.byteLength(input, 'utf8') > IMPORT_LIMITS.maxBytes) return { headers: [], rows: [], delimiter: ',', fileErrors: ['The file is larger than 2 MB. Split it into smaller files.'] };
  const text = input.replace(/^\uFEFF/, '');                 // Excel often adds a byte-order mark
  const delimiter = detectDelimiter(text);
  const records: string[][] = []; let field = '', row: string[] = [], inQ = false, i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } inQ = false; i++; continue; }
      field += ch; i++; continue;
    }
    if (ch === '"' && field === '') { inQ = true; i++; continue; }
    if (ch === delimiter) { row.push(field); field = ''; i++; continue; }
    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = ''; records.push(row); row = []; i++; continue;
    }
    field += ch; i++;
  }
  if (inQ) fileErrors.push('A quoted value is never closed (a missing closing quote). Check the file around the last rows.');
  if (field !== '' || row.length) { row.push(field); records.push(row); }
  const clean = records.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ''));   // blank lines are ignored
  if (!clean.length) return { headers: [], rows: [], delimiter, fileErrors: [...fileErrors, 'The file is empty.'] };
  const [headers, ...rows] = clean;
  if (rows.length > IMPORT_LIMITS.maxRows) fileErrors.push(`The file has ${rows.length} rows. The limit is ${IMPORT_LIMITS.maxRows} per import; split it into smaller files.`);
  return { headers, rows: rows.slice(0, IMPORT_LIMITS.maxRows), delimiter, fileErrors };
}
