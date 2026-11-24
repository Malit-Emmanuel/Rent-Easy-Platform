import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isSameOrigin } from './proxy-rules';

const root = join(__dirname, '..');
const files = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(n) && !/\.test\./.test(n) ? [p] : []; });

// A screen that calls the API with a method the server route does not forward fails with a vague "something went wrong" (this happened with PUT).
test('every HTTP method the screens use is forwarded by the proxy route', () => {
  const route = readFileSync(join(root, 'app/api/proxy/[...path]/route.ts'), 'utf8');
  const exported = new Set([...route.matchAll(/forward as ([A-Z]+)/g)].map((m) => m[1]));
  const used = new Set<string>();
  for (const f of files(root).filter((x) => !x.includes('proxy'))) for (const m of readFileSync(f, 'utf8').matchAll(/['"](GET|POST|PUT|PATCH|DELETE)['"]/g)) used.add(m[1]);
  assert.ok(used.size >= 3, 'found the methods in use');
  for (const m of used) assert.ok(exported.has(m), `${m} is used by a screen but not exported by the proxy route`);
});

test('PUT needs a same-site Origin like the other state-changing methods', () => {
  assert.equal(isSameOrigin('PUT', null, 'a.example'), false);
  assert.equal(isSameOrigin('PUT', 'https://a.example', 'a.example'), true);
  assert.equal(isSameOrigin('PUT', 'https://evil.example', 'a.example'), false);
});
