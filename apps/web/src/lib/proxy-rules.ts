// What the browser may reach through the dashboard's server routes. Everything else is refused.
const ALLOWED_PREFIXES = ['me', 'orgs', 'invitations', 'nodes', 'document-types', 'admin/verifications', 'review/cases', 'review/badges', 'admin/review', 'admin/integrity', 'admin/reports', 'admin/cost-inputs', 'admin/privacy'];

export function isAllowedProxyPath(segments: string[]): boolean {
  if (!segments.length || segments.some((s) => !s || s === '.' || s === '..' || /[\\\0%]/.test(s))) return false;
  const path = segments.join('/');
  return ALLOWED_PREFIXES.some((p) => path === p || path.startsWith(p + '/'));
}

/** CSRF defence for state-changing requests: the Origin header must match this site's own host. */
export function isSameOrigin(method: string, origin: string | null, host: string | null): boolean {
  if (['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())) return true;
  if (!origin || !host) return false;
  try { return new URL(origin).host === host; } catch { return false; }
}

/** The public search routes (no sign-in). Only these three shapes may be forwarded: the list, one listing by its id, and the areas. */
export function isAllowedPublicPath(segments: string[]): boolean {
  if (segments.length === 1) return segments[0] === 'listings' || segments[0] === 'areas';
  return segments.length === 2 && segments[0] === 'listings' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segments[1]);
}
