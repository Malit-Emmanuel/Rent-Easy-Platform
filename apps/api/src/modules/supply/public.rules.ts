// Pure rules for public search: query parsing and the per-address request limit. No database.
export interface PublicQuery { nodeId?: number; bedrooms?: number; maxRent?: number; minRent?: number; verified?: boolean; sort: 'new' | 'cost'; limit: number; offset: number }

const whole = (v: unknown) => (typeof v === 'string' && /^\d{1,9}$/.test(v) ? Number(v) : undefined);

export function parsePublicQuery(q: Record<string, unknown>): { value: PublicQuery; errors: string[] } {
  const errors: string[] = []; const v: PublicQuery = { sort: 'new', limit: 20, offset: 0 };
  const int = (k: string, max: number, assign: (n: number) => void) => {
    if (q[k] === undefined || q[k] === '') return;
    const n = whole(q[k]); if (n === undefined || n > max) errors.push(`${k} must be a whole number up to ${max}`); else assign(n);
  };
  int('node', 1_000_000, (n) => { v.nodeId = n; });
  int('bedrooms', 20, (n) => { v.bedrooms = n; });
  int('minRent', 100_000_000, (n) => { v.minRent = n; });
  int('maxRent', 100_000_000, (n) => { v.maxRent = n; });
  int('limit', 50, (n) => { v.limit = Math.max(1, n); });
  int('offset', 10_000, (n) => { v.offset = n; });
  if (q.verified !== undefined && q.verified !== '') { if (q.verified === '1') v.verified = true; else errors.push('verified must be 1'); }
  if (q.sort !== undefined && q.sort !== '') { if (q.sort === 'new' || q.sort === 'cost') v.sort = q.sort; else errors.push('sort must be new or cost'); }
  if (v.minRent !== undefined && v.maxRent !== undefined && v.minRent > v.maxRent) errors.push('minRent cannot be more than maxRent');
  return { value: v, errors };
}

/** A small fixed-window counter per address, kept in memory (one API instance; resets on restart, which is acceptable for read-only browsing). */
export class RateWindow {
  private hits = new Map<string, { n: number; start: number }>();
  constructor(private max: number, private windowMs: number, private now: () => number = Date.now) {}
  /** True if this request is allowed. */
  take(key: string): boolean {
    const t = this.now(); const h = this.hits.get(key);
    if (!h || t - h.start >= this.windowMs) { this.hits.set(key, { n: 1, start: t }); this.sweep(t); return true; }
    h.n += 1; return h.n <= this.max;
  }
  private sweep(t: number) { if (this.hits.size > 5000) for (const [k, h] of this.hits) if (t - h.start >= this.windowMs) this.hits.delete(k); }
}
