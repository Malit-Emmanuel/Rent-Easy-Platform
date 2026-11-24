import { NextRequest, NextResponse } from 'next/server';
import { forwardIpHeaders, visitorIp } from '@/lib/forward-ip';
import { isAllowedPublicPath } from '@/lib/proxy-rules';
import { apiUrl } from '@/lib/session';

/**
 * Public search: read-only, no sign-in, no cookies sent or set. Only the list, one listing and the areas can be reached.
 * The visitor's address is passed on (when the shared secret is set) so the API's per-address limit applies to the visitor, not to this server.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  if (!isAllowedPublicPath(path)) return NextResponse.json({ message: 'Not found' }, { status: 404 });
  const r = await fetch(`${apiUrl()}/public/${path.join('/')}${req.nextUrl.search}`, { cache: 'no-store', headers: { ...forwardIpHeaders(visitorIp(req.headers)) } });
  return new NextResponse(await r.text(), { status: r.status, headers: { 'content-type': r.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' } });
}
