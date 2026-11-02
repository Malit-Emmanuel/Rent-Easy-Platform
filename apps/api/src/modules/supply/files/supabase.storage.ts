import { createHash } from 'crypto';
import { SignedUpload, StoragePort, StoredHead } from './storage.port';

export interface SupabaseStorageConfig { url: string; key: string; bucket: string }

/**
 * Supabase Storage over its REST API. The secret key stays on the server; the browser only ever sees short-lived signed links.
 * Legacy JWT-style keys are sent as both `apikey` and `Authorization: Bearer`; new `sb_secret_...` keys are sent as `apikey` only.
 */
export class SupabaseStorage implements StoragePort {
  readonly name = 'supabase';
  constructor(private cfg: SupabaseStorageConfig, private fetchFn: typeof fetch = fetch) {
    if (!/^https:\/\//.test(cfg.url) && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(cfg.url)) throw new Error('SUPABASE_URL must be an https address');
  }
  private base() { return this.cfg.url.replace(/\/$/, '') + '/storage/v1'; }
  private enc(path: string) { return path.split('/').map(encodeURIComponent).join('/'); }
  private auth(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = { apikey: this.cfg.key, ...extra };
    if (this.cfg.key.startsWith('eyJ')) h.authorization = `Bearer ${this.cfg.key}`;
    return h;
  }
  // Errors carry only a short code and the HTTP status, never the response body or any key.
  private fail(op: string, status: number): never { throw new Error(`storage_${op}_failed_${status}`); }

  async createSignedUpload(path: string, mimeType: string): Promise<SignedUpload> {
    const r = await this.fetchFn(`${this.base()}/object/upload/sign/${this.cfg.bucket}/${this.enc(path)}`, { method: 'POST', headers: this.auth({ 'content-type': 'application/json' }), body: '{}' });
    if (!r.ok) this.fail('sign_upload', r.status);
    const j: any = await r.json();
    const rel: string | undefined = j?.url;
    if (!rel) this.fail('sign_upload_shape', 200);
    const url = /^https?:\/\//.test(rel!) ? rel! : this.base() + rel;
    return { url, method: 'PUT', headers: { 'content-type': mimeType, 'x-upsert': 'false' }, expiresInSec: 7200 };
  }

  async head(path: string, bytes: number): Promise<StoredHead | null> {
    const r = await this.fetchFn(`${this.base()}/object/authenticated/${this.cfg.bucket}/${this.enc(path)}`, { headers: this.auth({ range: `bytes=0-${bytes - 1}` }) });
    if (r.status === 404) return null;
    if (r.status === 400) { const j: any = await r.json().catch(() => null); if (j?.statusCode === '404' || j?.error === 'not_found') return null; this.fail('head', 400); }
    if (!r.ok) this.fail('head', r.status);
    // Read only the first bytes even if the server ignores the Range header and sends the whole file.
    const reader = r.body!.getReader(); const chunks: Uint8Array[] = []; let got = 0;
    while (got < bytes) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); got += value.length; }
    await reader.cancel().catch(() => {});
    const first = new Uint8Array(Math.min(got, bytes)); let o = 0;
    for (const c of chunks) { const take = Math.min(c.length, first.length - o); first.set(c.subarray(0, take), o); o += take; if (o >= first.length) break; }
    const cr = r.headers.get('content-range'); const total = cr?.match(/\/(\d+)$/)?.[1] ?? (r.status === 200 ? r.headers.get('content-length') : null);
    if (total === null || total === undefined) this.fail('head_size', r.status);
    return { size: Number(total), firstBytes: first };
  }

  async createSignedDownload(path: string, ttlSec: number, downloadName?: string): Promise<string> {
    const r = await this.fetchFn(`${this.base()}/object/sign/${this.cfg.bucket}/${this.enc(path)}`, { method: 'POST', headers: this.auth({ 'content-type': 'application/json' }), body: JSON.stringify({ expiresIn: ttlSec }) });
    if (!r.ok) this.fail('sign_download', r.status);
    const j: any = await r.json(); const rel: string | undefined = j?.signedURL ?? j?.signedUrl;
    if (!rel) this.fail('sign_download_shape', 200);
    const full = /^https?:\/\//.test(rel!) ? rel! : this.base() + (rel!.startsWith('/') ? rel! : '/' + rel!);
    return downloadName ? `${full}${full.includes('?') ? '&' : '?'}download=${encodeURIComponent(downloadName)}` : full;
  }

  /** Streams the object through a hash; nothing is kept in memory beyond one chunk. */
  async sha256(path: string): Promise<Buffer | null> {
    const r = await this.fetchFn(`${this.base()}/object/authenticated/${this.cfg.bucket}/${this.enc(path)}`, { headers: this.auth() });
    if (r.status === 404) return null;
    if (r.status === 400) { const j: any = await r.json().catch(() => null); if (j?.statusCode === '404' || j?.error === 'not_found') return null; this.fail('hash', 400); }
    if (!r.ok || !r.body) this.fail('hash', r.status);
    const h = createHash('sha256'); const reader = r.body!.getReader();
    for (;;) { const { done, value } = await reader.read(); if (done) break; h.update(value); }
    return h.digest();
  }

  async remove(path: string): Promise<void> {
    const r = await this.fetchFn(`${this.base()}/object/${this.cfg.bucket}/${this.enc(path)}`, { method: 'DELETE', headers: this.auth() });
    if (!r.ok && r.status !== 404 && r.status !== 400) this.fail('remove', r.status);
  }
}
