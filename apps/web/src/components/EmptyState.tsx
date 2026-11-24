import Link from 'next/link';
import { ReactNode } from 'react';

/** A friendly "nothing here yet" panel: what this is, what to do next, one button. */
export default function EmptyState({ title, children, href, action }: { title: string; children?: ReactNode; href?: string; action?: string }) {
  return (
    <div className="empty rich">
      <strong>{title}</strong>
      {children && <p>{children}</p>}
      {href && action && <Link className="btn" href={href}>{action}</Link>}
    </div>
  );
}
