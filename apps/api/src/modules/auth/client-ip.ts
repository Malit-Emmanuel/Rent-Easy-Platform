import { timingSafeEqual } from 'crypto';
import { isIP } from 'net';

/** Expand an IPv6 address to eight groups so its network part (the first four groups, a /64) can be taken. */
function v6Prefix(addr: string): string {
  const [head, tail = ''] = addr.split('::');
  const h = head ? head.split(':') : [], t = tail ? tail.split(':') : [];
  const mid = addr.includes('::') ? Array(Math.max(0, 8 - h.length - t.length)).fill('0') : [];
  return [...h, ...mid, ...t].slice(0, 4).map((g) => g.toLowerCase().replace(/^0+(?=.)/, '')).join(':') + '::/64';
}

/** One address per person as far as limits go: IPv4 as is, IPv6 by its /64 (a person can rotate within it freely). */
export function normaliseIp(raw: string | undefined): string | null {
  if (!raw) return null;
  let a = raw.trim();
  if (a.toLowerCase().startsWith('::ffff:') && isIP(a.slice(7)) === 4) a = a.slice(7);
  if (a.includes('%')) a = a.split('%')[0];
  const v = isIP(a);
  return v === 4 ? a : v === 6 ? v6Prefix(a) : null;
}

const one = (h: string | string[] | undefined) => (Array.isArray(h) ? h[0] : h);
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * The address limits are counted against.
 * 1. The dashboard server forwards the visitor's address with a shared secret. It is believed only when the secret matches,
 *    because anyone can send a header of their own.
 * 2. Otherwise the last entry of X-Forwarded-For: the entry our own host (Railway) added. Earlier entries are written by the caller and are ignored.
 * 3. Otherwise the direct connection.
 */
export function clientIp(req: { headers: Record<string, string | string[] | undefined>; socket?: { remoteAddress?: string } }, proxyKey?: string): string | null {
  const fwd = one(req.headers['x-zuri-client-ip']), proof = one(req.headers['x-zuri-proxy-key']);
  if (proxyKey && fwd && proof && same(proof, proxyKey)) { const n = normaliseIp(fwd); if (n) return n; }
  const xff = one(req.headers['x-forwarded-for']);
  const last = xff ? xff.split(',').pop() : undefined;
  return normaliseIp(last) ?? normaliseIp(req.socket?.remoteAddress);
}
