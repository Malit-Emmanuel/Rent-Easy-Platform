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

export interface RiskInput { orgAgeDays: number; priorRejections: number; docTypes: string[]; newestDocAgeMinutes: number; isAppeal: boolean; priorRevocations?: number }
/** Flags only change the order of the queue. They never decide anything. */
export function riskFlags(i: RiskInput): string[] {
  const f: string[] = [];
  if (i.orgAgeDays < NEW_ORG_DAYS) f.push('new_organisation');
  if (i.priorRejections > 0) f.push('previously_rejected');
  if (!i.docTypes.includes('title_deed') && i.docTypes.includes('lease_agreement')) f.push('lease_only');
  if (i.newestDocAgeMinutes < 60) f.push('fresh_upload');
  if ((i.priorRevocations ?? 0) > 0) f.push('previously_revoked');
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

export const REASON_CODES = ['doc_unreadable', 'doc_owner_mismatch', 'doc_expired', 'authorisation_missing', 'property_mismatch', 'suspected_forgery', 'other'] as const;
export const BADGE_MONTHS = 12;
export const RENEWAL_WINDOW_DAYS = 30;   // a badge can be renewed in its last 30 days, so there is no gap

/** Whether a new request is allowed given the current badge (if any). */
export function canRenew(badge: { expiresAt: Date; revokedAt: Date | null } | null, now: Date): boolean {
  if (!badge || badge.revokedAt || badge.expiresAt.getTime() <= now.getTime()) return true;
  return badge.expiresAt.getTime() - now.getTime() <= RENEWAL_WINDOW_DAYS * 86_400_000;
}
export type Decision = 'approve' | 'needs_changes' | 'reject';

/** Returns an error message, or null when the decision is well formed. Approving needs no reason; the other two always do. */
export function checkDecision(d: { decision?: unknown; reasonCode?: unknown; note?: unknown }): string | null {
  if (d.decision !== 'approve' && d.decision !== 'needs_changes' && d.decision !== 'reject') return 'decision must be approve, needs_changes or reject';
  const note = typeof d.note === 'string' ? d.note.trim() : '';
  if (d.note !== undefined && d.note !== null && typeof d.note !== 'string') return 'note must be text';
  if (note.length > 500) return 'note is limited to 500 characters';
  if (d.decision === 'approve') return d.reasonCode ? 'an approval has no reason code' : null;
  if (typeof d.reasonCode !== 'string' || !(REASON_CODES as readonly string[]).includes(d.reasonCode)) return 'a valid reason code is required';
  if (d.reasonCode === 'other' && !note) return 'the reason "other" needs a written note';
  return null;
}

/** Twelve calendar months from the issue date. */
export function badgeExpiry(from: Date): Date { const d = new Date(from); d.setUTCMonth(d.getUTCMonth() + BADGE_MONTHS); return d; }

/** A revoke always needs a valid reason code; "other" also needs a written note. */
export function checkRevoke(d: { reasonCode?: unknown; note?: unknown }, allowed: readonly string[] = REASON_CODES): string | null {
  if (d.note !== undefined && d.note !== null && typeof d.note !== 'string') return 'note must be text';
  const note = typeof d.note === 'string' ? d.note.trim() : '';
  if (note.length > 500) return 'note is limited to 500 characters';
  if (typeof d.reasonCode !== 'string' || !allowed.includes(d.reasonCode)) return 'a valid reason code is required';
  if (d.reasonCode === 'other' && !note) return 'the reason "other" needs a written note';
  return null;
}
