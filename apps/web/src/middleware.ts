import { NextRequest, NextResponse } from 'next/server';

// Pages need a session cookie; the API still checks the token on every call, this just avoids showing empty shells.
export function middleware(req: NextRequest) {
  const has = !!req.cookies.get('khp_rt')?.value;
  const onLogin = req.nextUrl.pathname === '/login';
  const path = req.nextUrl.pathname;
  if (['/privacy', '/terms', '/welcome', '/verified'].includes(path)) return NextResponse.next();   // readable without signing in
  if (!has && path === '/') return NextResponse.redirect(new URL('/welcome', req.url));             // visitors see the public home page; signed-in people see their dashboard
  if (!has && !onLogin) return NextResponse.redirect(new URL('/login', req.url));
  if (has && onLogin) return NextResponse.redirect(new URL('/', req.url));
  return NextResponse.next();
}
export const config = { matcher: ['/((?!api/|_next/|favicon.ico|manifest.webmanifest|icon.svg|apple-icon.png|icons/).*)'] };
