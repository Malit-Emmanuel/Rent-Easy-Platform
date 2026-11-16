import Link from 'next/link';

// Until real photos are shown here, each property gets a calm colour tile (same colour every time for the same name).
const TONES = ['linear-gradient(135deg,#2f7a62,#173f33)', 'linear-gradient(135deg,#b4673c,#6e3a1f)', 'linear-gradient(135deg,#4b7bb0,#283f5e)', 'linear-gradient(135deg,#d0a14b,#7d5a17)', 'linear-gradient(135deg,#7a5c8f,#3f2d4f)', 'linear-gradient(135deg,#3f8f9a,#1d4b52)'];
const tone = (s: string) => TONES[[...s].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7) % TONES.length];

export interface PropertyRow { id: string; name: string; addressText: string; nodeName?: string | null; unitCount: number; caseStatus?: string | null; verifiedUntil?: string | null }

export default function PropertyCard({ orgId, p, units, one, tag, state }: { orgId: string; p: PropertyRow; units: string; one: string; tag?: string; state?: string }) {
  return (
    <Link className="pcard" href={`/orgs/${orgId}/properties/${p.id}`}>
      <div className="pic" style={{ background: tone(p.name) }}>
        {tag && <span className="chip">{tag}</span>}
        {state && <span className={`chip vchip ${p.verifiedUntil ? 'ok' : ''}`}>{state}</span>}
        <span>{p.name.trim().charAt(0).toUpperCase()}</span>
      </div>
      <div className="body">
        <strong>{p.name}</strong>
        <div className="msg">{p.addressText}{p.nodeName ? ` · ${p.nodeName}` : ''}</div>
        <div className="msg">{p.unitCount} {p.unitCount === 1 ? one : units}</div>
      </div>
    </Link>
  );
}

// Short label for the chip on a card; null when nothing has been requested yet.
export function cardState(p: PropertyRow, t: (k: any) => string): string | undefined {
  if (p.verifiedUntil) return t('pvApproved' as any);
  const m: Record<string, string> = { submitted: 'pvSubmitted', in_review: 'pvIn_review', needs_changes: 'pvNeeds_changes', rejected: 'pvRejected' };
  if (p.caseStatus === 'approved') return t('pvEnded' as any);   // approved once, but the badge has expired or been withdrawn
  return p.caseStatus && m[p.caseStatus] ? t(m[p.caseStatus] as any) : undefined;
}
