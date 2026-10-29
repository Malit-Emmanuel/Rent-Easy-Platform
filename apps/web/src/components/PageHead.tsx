import Link from 'next/link';

/** Standard top of every page: optional back link, small label, title and optional actions. */
export default function PageHead({ back, eyebrow, title, children }: { back?: { href: string; label: string }; eyebrow?: string; title: string; children?: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 8 }}>
      {back && <Link className="crumb" href={back.href}>← {back.label}</Link>}
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <div className="row"><h1 style={{ margin: '4px 0 12px' }}>{title}</h1><span className="spacer" />{children}</div>
    </div>
  );
}
