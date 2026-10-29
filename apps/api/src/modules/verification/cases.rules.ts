// Pure rules for T1 review cases (no database). The service applies them; tests pin them down.

export const T1_DEADLINE_WORKING_DAYS = 2;
export const APPEAL_WINDOW_DAYS = 14;
export const NEW_ORG_DAYS = 30;

/** Adds working days (Monday to Friday). Public holidays are ignored in v1. Time of day is kept. */
export function addWorkingDays(from: Date, days: number): Date {
  const d = new Date(from.getTime());
  let left = days;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) left--;
  }
  // a request made at the weekend starts its clock on Monday
  return d;
}

/**
 * PLACEHOLDER proof rules until the advocate confirms the acceptable documents (open launch gate).
 * Title deed or lease is always needed; a letter of authority is also needed unless the organisation is the landlord.
 */
export function missingProof(docTypes: string[], orgKind: string): string[] {
  const have = new Set(docTypes);
  const missing: string[] = [];
  if (!have.has('title_deed') && !have.has('lease_agreement')) missing.push('title_deed_or_lease');
  if (orgKind !== 'landlord' && !have.has('management_authorisation')) missing.push('management_authorisation');
  return missing;
}

export interface RiskInput { orgAgeDays: number; priorRejections: number; docTypes: string[]; newestDocAgeMinutes: number; isAppeal: boolean }
/** Flags only change the order of the queue. They never decide anything. */
export function riskFlags(i: RiskInput): string[] {
  const f: string[] = [];
  if (i.orgAgeDays < NEW_ORG_DAYS) f.push('new_organisation');
  if (i.priorRejections > 0) f.push('previously_rejected');
  if (!i.docTypes.includes('title_deed') && i.docTypes.includes('lease_agreement')) f.push('lease_only');
  if (i.newestDocAgeMinutes < 60) f.push('fresh_upload');
  if (i.isAppeal) f.push('appeal');
  return f;
}

export function canAppeal(c: { status: string; decidedAt: Date | null; appealOf: string | null; hasAppeal: boolean }, now: Date): boolean {
  if (c.status !== 'rejected' || !c.decidedAt || c.appealOf || c.hasAppeal) return false;
  return now.getTime() - c.decidedAt.getTime() <= APPEAL_WINDOW_DAYS * 86_400_000;
}

/** What the manager sees. Expired and revoked badges never count. */
export function badgeValid(b: { expiresAt: Date; revokedAt: Date | null } | null | undefined, now: Date): boolean {
  return !!b && !b.revokedAt && b.expiresAt.getTime() > now.getTime();
}
