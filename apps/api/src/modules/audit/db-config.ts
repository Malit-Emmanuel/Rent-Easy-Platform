import type { PoolConfig } from 'pg';

/**
 * Database pool settings from the environment, with TLS made explicit.
 *
 * Why: the pg library ignores an explicit `ssl` option whenever the URL carries `?sslmode=...`, so a CA certificate
 * supplied separately would be silently dropped. We strip `sslmode` from the URL and decide TLS ourselves:
 *   - DATABASE_SSL_CA set          -> verified TLS against that CA (e.g. Supabase's CA certificate)
 *   - sslmode=disable              -> no TLS (local development only)
 *   - sslmode=no-verify            -> encrypted but NOT verified (explicit opt-out; not for real data)
 *   - any other sslmode, or DATABASE_SSL=require -> verified TLS using the system trust store
 *   - nothing set                  -> no TLS (local development)
 */
export function poolConfigFromEnv(env: NodeJS.ProcessEnv = process.env): PoolConfig {
  let url = env.DATABASE_URL;
  let mode: string | undefined = env.DATABASE_SSL === 'require' ? 'require' : undefined;

  if (url) {
    const m = url.match(/[?&]sslmode=([^&]*)/);
    if (m) {
      mode = decodeURIComponent(m[1]);
      url = url.replace(/([?&])sslmode=[^&]*(&|$)/, (_all, lead: string, tail: string) => (tail === '&' ? lead : '')).replace(/[?&]$/, '');
    }
  }

  const ca = env.DATABASE_SSL_CA?.trim();
  let ssl: PoolConfig['ssl'];
  if (ca) ssl = { ca, rejectUnauthorized: true };
  else if (mode === 'disable' || mode === undefined) ssl = undefined;
  else if (mode === 'no-verify') ssl = { rejectUnauthorized: false };
  else ssl = { rejectUnauthorized: true };

  return {
    connectionString: url,
    max: Number(env.PG_POOL_MAX ?? 5),   // serverless/containers: keep pools small
    idleTimeoutMillis: 10_000,
    ssl,
  };
}
