/**
 * Headers that tell the API which visitor a sign-in call is for, so its per-address limits apply to the visitor and not to this server.
 * The secret (TRUSTED_PROXY_KEY, the same value on the API) proves the header is ours. Without it nothing is sent and the API sees this server's address.
 */
export function visitorIp(h: { get(name: string): string | null }): string | undefined {
  const real = h.get('x-real-ip')?.trim();
  if (real) return real;
  const first = h.get('x-forwarded-for')?.split(',')[0]?.trim();   // Vercel writes this header itself, so the first entry is the visitor
  return first || undefined;
}
export function forwardIpHeaders(ip: string | undefined, key = process.env.TRUSTED_PROXY_KEY): Record<string, string> {
  return ip && key && key.length >= 32 ? { 'x-zuri-client-ip': ip, 'x-zuri-proxy-key': key } : {};
}
