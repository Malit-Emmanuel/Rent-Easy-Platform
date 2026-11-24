// Rules shared by the listing service and the screens' wording. Pure: no database.
export const COST_TYPES = ['rent', 'deposit', 'utility_deposit', 'service_charge', 'agent_fee'] as const;
export type CostType = typeof COST_TYPES[number];
export const COST_KEYS = { rent: 'rent', deposit: 'deposit', utilityDeposit: 'utility_deposit', serviceCharge: 'service_charge', agentFee: 'agent_fee' } as const;
export type CostKey = keyof typeof COST_KEYS;

/** Reminder after 14 days, hidden after 21 days without a confirmation (tunable; the hiding job is a later slice). */
export const REMIND_AFTER_DAYS = 14;
export const HIDE_AFTER_DAYS = 21;
export const MAX_SHILLINGS = 100_000_000;

export type ListingStatus = 'draft' | 'published' | 'stale' | 'let' | 'withdrawn';
export const OPEN: ListingStatus[] = ['draft', 'published', 'stale'];

/** Which action may start from which status. */
export const ALLOWED: Record<'publish' | 'confirm' | 'let' | 'withdraw' | 'costs', ListingStatus[]> = {
  publish: ['draft'],
  confirm: ['published', 'stale'],
  let: ['published', 'stale'],
  withdraw: ['draft', 'published', 'stale'],
  costs: ['draft', 'published', 'stale'],
};

export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

export interface CostsInput { rent?: number; deposit?: number; utilityDeposit?: number; serviceCharge?: number; agentFee?: number }

/** Amounts are whole Kenya shillings. Zero is allowed for everything except rent. */
export function checkCosts(body: any, mode: 'all' | 'some'): { value: CostsInput; errors: string[] } {
  const errors: string[] = []; const v: CostsInput = {};
  const b = body && typeof body === 'object' ? body : {};
  for (const k of Object.keys(COST_KEYS) as CostKey[]) {
    if (b[k] === undefined) { if (mode === 'all') errors.push(`${k} is required (enter 0 if there is none)`); continue; }
    const n = b[k];
    if (!Number.isInteger(n) || n < 0 || n > MAX_SHILLINGS) errors.push(`${k} must be a whole number of shillings from 0 to ${MAX_SHILLINGS}`);
    else if (k === 'rent' && n < 1) errors.push('rent must be more than 0');
    else v[k] = n;
  }
  if (!errors.length && Object.keys(v).length === 0) errors.push('nothing to update');
  return { value: v, errors };
}

export const totalMoveIn = (c: Partial<Record<CostKey, number | null>>): number | null => {
  const ks = Object.keys(COST_KEYS) as CostKey[];
  return ks.every((k) => typeof c[k] === 'number') ? ks.reduce((s, k) => s + (c[k] as number), 0) : null;
};

export const missingCosts = (c: Partial<Record<CostKey, number | null>>): CostKey[] =>
  (Object.keys(COST_KEYS) as CostKey[]).filter((k) => typeof c[k] !== 'number');
