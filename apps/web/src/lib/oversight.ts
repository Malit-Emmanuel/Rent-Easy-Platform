// Small pure helpers for the oversight screens. Months are Kenyan calendar months (Africa/Nairobi), written YYYY-MM.

export const currentMonth = (now = new Date()): string => new Date(now.getTime() + 3 * 3600e3).toISOString().slice(0, 7);

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
}

/** The last `count` months, newest first, never earlier than January 2024 (the earliest month the reports accept). */
export function monthOptions(now = new Date(), count = 12): string[] {
  const out: string[] = []; let m = currentMonth(now);
  for (let i = 0; i < count && m >= '2024-01'; i++) { out.push(m); m = shiftMonth(m, -1); }
  return out;
}

const group = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
export function fmtKes(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const [whole, frac] = Math.abs(n).toFixed(2).split('.');
  return `${n < 0 ? '-' : ''}KES ${group(Number(whole))}${frac === '00' ? '' : '.' + frac}`;
}
export function fmtNum(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return String(Math.round(n * 10 ** digits) / 10 ** digits);
}
export const fmtPct = (n: number | null | undefined): string => (n === null || n === undefined ? '—' : `${fmtNum(n)}%`);

/** What a person types into an amount box: "1,500.50" becomes 1500.5; empty, negative or not a number becomes null. */
export function parseAmount(text: string): number | null {
  const s = text.trim().replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n <= 1e9 ? n : null;
}

const HIDDEN_FIGURES = new Set(['orgId', 'flags', 'startedAt', 'thresholdHours']);
/** The figures of an alert, ready to show: raw keys (looked up as fig_<key> for labels) and plain values. Identifiers and lists are left out. */
export function figureEntries(figures: Record<string, unknown> | null | undefined): { key: string; value: string }[] {
  return Object.entries(figures ?? {})
    .filter(([k, v]) => !HIDDEN_FIGURES.has(k) && (typeof v === 'number' || typeof v === 'string'))
    .map(([key, v]) => ({ key, value: typeof v === 'number' ? fmtNum(v, 2) : String(v) }));
}

/** A short, readable case number: the first 8 characters of its id. Enough to find it, and not the contents. */
export const shortId = (id: string): string => id.slice(0, 8);
