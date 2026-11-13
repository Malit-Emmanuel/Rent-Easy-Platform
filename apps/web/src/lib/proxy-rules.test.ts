import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedProxyPath as ok, isSameOrigin as same } from './proxy-rules';

test('allows dashboard resources only', () => {
  for (const p of [['me'], ['me', 'verification'], ['orgs', 'x', 'members'], ['invitations', 'accept'], ['nodes'], ['document-types'], ['orgs', 'x', 'properties', 'y', 'files', 'z', 'link'], ['orgs', 'x', 'properties', 'y', 'units'], ['admin', 'verifications', 'queue']]) assert.equal(ok(p), true, p.join('/'));
  for (const p of [['auth', 'otp', 'request'], ['webhooks', 'identity', 'fake'], ['internal', 'cron', 'x'], ['health'], ['admin'], []]) assert.equal(ok(p), false, p.join('/'));
});
test('rejects traversal and odd segments', () => {
  for (const p of [['me', '..', 'auth'], ['orgs', '', 'x'], ['me', 'a%2e%2e'], ['me\\x']]) assert.equal(ok(p), false, p.join('/'));
});
test('state-changing requests need a same-site Origin', () => {
  assert.equal(same('GET', null, 'a.com'), true);
  assert.equal(same('POST', 'https://a.com', 'a.com'), true);
  assert.equal(same('POST', 'https://evil.com', 'a.com'), false);
  assert.equal(same('DELETE', null, 'a.com'), false);
  assert.equal(same('POST', 'not a url', 'a.com'), false);
});

test('reviewer case routes are proxied, nothing next to them is', () => {
  assert.equal(ok(['review', 'cases', 'queue']), true);
  assert.equal(ok(['review', 'cases', 'abc', 'claim']), true);
  assert.equal(ok(['review']), false);
  assert.equal(ok(['review-other', 'cases']), false);
});

test('oversight routes are proxied, nothing next to them is', () => {
  for (const p of [['admin', 'review', 'stale-claims'], ['admin', 'review', 'access'], ['admin', 'review', 'cases', 'x', 'release'], ['admin', 'integrity', 'alerts'], ['admin', 'integrity', 'alerts', 'x', 'handle'], ['admin', 'integrity', 'rules', 'burst'],
    ['admin', 'reports', 'queue'], ['admin', 'reports', 'cost'], ['admin', 'reports', 'reviewers'], ['admin', 'cost-inputs'], ['review', 'cases', 'my-stats']]) assert.equal(ok(p), true, p.join('/'));
  for (const p of [['admin', 'reviewing'], ['admin', 'integrity-x'], ['admin', 'reports-old'], ['admin', 'users'], ['admin', 'cost-inputsx']]) assert.equal(ok(p), false, p.join('/'));
});

test('privacy routes: own data under me/, administrator handling under admin/privacy, nothing next to them', () => {
  for (const p of [['me', 'data-export'], ['me', 'data-requests'], ['admin', 'privacy', 'requests'], ['admin', 'privacy', 'requests', 'x', 'handle']]) assert.equal(ok(p), true, p.join('/'));
  for (const p of [['admin', 'privacyx'], ['admin', 'privacy-old', 'requests']]) assert.equal(ok(p), false, p.join('/'));
});
