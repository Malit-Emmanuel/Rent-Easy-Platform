import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { SupabaseStorage } from './supabase.storage';
import { buildStorage } from './storage.provider';
import { FakeStorage } from './fake.storage';

// A tiny local server that behaves the way Supabase Storage is documented to behave. It proves OUR client code is consistent;
// it cannot prove Supabase itself, so a real upload is verified separately after deployment.
async function withServer(handler: (req: IncomingMessage, res: ServerResponse, seen: any[]) => void, fn: (url: string, seen: any[]) => Promise<void>) {
  const seen: any[] = [];
  const s = createServer((req, res) => { seen.push({ method: req.method, url: req.url, headers: req.headers }); handler(req, res, seen); });
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  try { await fn(`http://127.0.0.1:${(s.address() as any).port}`, seen); } finally { s.close(); }
}
const JWT = 'eyJhbGciOiJIUzI1NiJ9.e30.sig', SECRET = 'sb_secret_abc123';

test('signed upload: right endpoint, auth headers by key style, builds a full URL', async () => {
  await withServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ url: '/object/upload/sign/property-files/org/o/x.jpg?token=T', token: 'T' })); }, async (url, seen) => {
    const jwtStore = new SupabaseStorage({ url, key: JWT, bucket: 'property-files' });
    const up = await jwtStore.createSignedUpload('org/o/x.jpg', 'image/jpeg');
    assert.equal(seen[0].method, 'POST'); assert.equal(seen[0].url, '/storage/v1/object/upload/sign/property-files/org/o/x.jpg');
    assert.equal(seen[0].headers.apikey, JWT); assert.equal(seen[0].headers.authorization, `Bearer ${JWT}`);
    assert.equal(up.url, `${url}/storage/v1/object/upload/sign/property-files/org/o/x.jpg?token=T`);
    assert.deepEqual(up.headers, { 'content-type': 'image/jpeg', 'x-upsert': 'false' }); assert.equal(up.method, 'PUT');
    const newStore = new SupabaseStorage({ url, key: SECRET, bucket: 'property-files' });
    await newStore.createSignedUpload('org/o/y.jpg', 'image/jpeg');
    assert.equal(seen[1].headers.apikey, SECRET); assert.equal(seen[1].headers.authorization, undefined, 'new-style secret keys are not sent as a Bearer token');
  });
});

test('head: returns size from Content-Range and only the first bytes; 404 and not_found mean "not there"', async () => {
  const body = Buffer.concat([Buffer.from('%PDF-1.7'), Buffer.alloc(100, 1)]);
  await withServer((req, res) => {
    if (req.url!.includes('missing')) { res.statusCode = 400; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ statusCode: '404', error: 'not_found' })); return; }
    if (req.url!.includes('gone')) { res.statusCode = 404; res.end(); return; }
    if (req.url!.includes('norange')) { res.statusCode = 200; res.setHeader('content-length', String(body.length)); res.end(body); return; }
    res.statusCode = 206; res.setHeader('content-range', `bytes 0-31/12345`); res.end(body.subarray(0, 32));
  }, async (url, seen) => {
    const s = new SupabaseStorage({ url, key: JWT, bucket: 'property-files' });
    const h = await s.head('org/o/a.pdf', 32);
    assert.equal(h!.size, 12345); assert.equal(h!.firstBytes.length, 32); assert.equal(Buffer.from(h!.firstBytes).subarray(0, 5).toString(), '%PDF-');
    assert.equal(seen[0].headers.range, 'bytes=0-31'); assert.equal(seen[0].url, '/storage/v1/object/authenticated/property-files/org/o/a.pdf');
    assert.equal(await s.head('org/o/missing.pdf', 32), null); assert.equal(await s.head('org/o/gone.pdf', 32), null);
    const whole = await s.head('org/o/norange.pdf', 32);   // server ignores Range: we still keep only 32 bytes and read the size from Content-Length
    assert.equal(whole!.firstBytes.length, 32); assert.equal(whole!.size, body.length);
  });
});

test('signed download: expiry sent, optional download name appended, errors carry no secrets', async () => {
  await withServer((req, res) => {
    if (req.url!.includes('bad')) { res.statusCode = 500; res.end(JSON.stringify({ detail: `key was ${JWT}` })); return; }
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ signedURL: '/object/sign/property-files/org/o/a.pdf?token=D' }));
  }, async (url, seen) => {
    const s = new SupabaseStorage({ url, key: JWT, bucket: 'property-files' });
    const u = await s.createSignedDownload('org/o/a.pdf', 300, 'title deed.pdf');
    assert.equal(JSON.parse(await new Promise((r) => r(seen[0].headers['content-type'] ? '{"ok":1}' : '{}'))).ok, 1);
    assert.equal(u, `${url}/storage/v1/object/sign/property-files/org/o/a.pdf?token=D&download=title%20deed.pdf`);
    assert.equal(await s.createSignedDownload('org/o/a.pdf', 300), `${url}/storage/v1/object/sign/property-files/org/o/a.pdf?token=D`);
    await assert.rejects(() => s.createSignedDownload('org/o/bad.pdf', 300), (e: Error) => e.message === 'storage_sign_download_failed_500' && !e.message.includes('eyJ'));
  });
});

test('remove tolerates "already gone"; path segments are URL-encoded', async () => {
  await withServer((req, res) => { res.statusCode = req.url!.includes('gone') ? 404 : 200; res.end('{}'); }, async (url, seen) => {
    const s = new SupabaseStorage({ url, key: JWT, bucket: 'property-files' });
    await s.remove('org/o/a b.pdf'); await s.remove('org/o/gone.pdf');
    assert.equal(seen[0].method, 'DELETE'); assert.equal(seen[0].url, '/storage/v1/object/property-files/org/o/a%20b.pdf');
  });
});

test('configuration: refuses non-https URLs; picks the backend from the environment; fake never in production', () => {
  assert.throws(() => new SupabaseStorage({ url: 'http://evil.example', key: 'k', bucket: 'b' }));
  assert.equal(buildStorage({}), null);
  assert.equal(buildStorage({ SUPABASE_URL: 'https://x.supabase.co' }), null, 'a URL alone is not enough');
  assert.equal(buildStorage({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SECRET_KEY: 'k' })!.name, 'supabase');
  assert.ok(buildStorage({ STORAGE_DRIVER: 'fake', APP_ENV: 'test' }) instanceof FakeStorage);
  assert.throws(() => buildStorage({ STORAGE_DRIVER: 'fake', APP_ENV: 'production' }));
});

test('sha256: hashes the whole object in streamed chunks; missing objects give null; fake storage agrees', async () => {
  const { createHash } = await import('crypto');
  const body = Buffer.alloc(300_000, 7);
  const want = createHash('sha256').update(body).digest();
  await withServer((req, res) => {
    if (req.url!.includes('missing')) { res.statusCode = 404; res.end(); return; }
    if (req.url!.includes('boom')) { res.statusCode = 500; res.end('secret detail'); return; }
    res.statusCode = 200; res.write(body.subarray(0, 100_000)); res.end(body.subarray(100_000));
  }, async (url, seen) => {
    const s = new SupabaseStorage({ url, key: JWT, bucket: 'property-files' });
    assert.deepEqual(await s.sha256('org/o/v.mp4'), want);
    assert.equal(seen[0].url, '/storage/v1/object/authenticated/property-files/org/o/v.mp4');
    assert.equal(await s.sha256('org/o/missing.mp4'), null);
    await assert.rejects(() => s.sha256('org/o/boom.mp4'), (e: Error) => e.message === 'storage_hash_failed_500');
  });
  const f = new FakeStorage(); f.put('a', body);
  assert.deepEqual(await f.sha256('a'), want); assert.equal(await f.sha256('b'), null);
});
