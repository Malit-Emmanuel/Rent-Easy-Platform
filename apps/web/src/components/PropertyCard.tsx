import Link from 'next/link';

// Until real photos are shown here, each property gets a calm colour tile (same colour every time for the same name).
const TONES = ['linear-gradient(135deg,#3a3f3d,#0f1110)', 'linear-gradient(135deg,#d01a21,#6a0a0f)', 'linear-gradient(135deg,#566072,#1f2733)', 'linear-gradient(135deg,#9a7a42,#47341a)', 'linear-gradient(135deg,#8a3a46,#3a1620)', 'linear-gradient(135deg,#4a6a8f,#1d2e45)'];
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
