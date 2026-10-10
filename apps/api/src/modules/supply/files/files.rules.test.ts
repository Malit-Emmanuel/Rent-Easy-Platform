import test from 'node:test';
import assert from 'node:assert/strict';
import { checkFileRequest, cleanName, storagePath, MB } from './files.rules';

const ok = { kind: 'photo', mimeType: 'image/jpeg', sizeBytes: 1000 };
test('valid requests are accepted for each kind', () => {
  assert.equal(checkFileRequest(ok).errors.length, 0);
  assert.equal(checkFileRequest({ kind: 'document', docType: 'title_deed', mimeType: 'application/pdf', sizeBytes: 5 * MB }).errors.length, 0);
  assert.equal(checkFileRequest({ kind: 'video', mimeType: 'video/mp4', sizeBytes: 40 * MB }).errors.length, 0);
});
test('unknown kinds and null bodies are refused', () => {
  assert.ok(checkFileRequest({ kind: 'script', mimeType: 'text/html', sizeBytes: 1 }).errors.length > 0);
  assert.ok(checkFileRequest(null).errors.length > 0);
});
test('types must match the kind (no video as a photo, no HTML anywhere)', () => {
  assert.ok(checkFileRequest({ ...ok, mimeType: 'video/mp4' }).errors.length > 0);
  assert.ok(checkFileRequest({ ...ok, mimeType: 'text/html' }).errors.length > 0);
  assert.ok(checkFileRequest({ ...ok, mimeType: 'image/svg+xml' }).errors.length > 0);
  assert.ok(checkFileRequest({ kind: 'document', docType: 'other', mimeType: 'application/zip', sizeBytes: 5 }).errors.length > 0);
});
test('size limits per kind', () => {
  assert.ok(checkFileRequest({ ...ok, sizeBytes: 8 * MB + 1 }).errors.length > 0);
  assert.equal(checkFileRequest({ ...ok, sizeBytes: 8 * MB }).errors.length, 0);
  assert.ok(checkFileRequest({ kind: 'video', mimeType: 'video/mp4', sizeBytes: 45 * MB + 1 }).errors.length > 0);
  for (const bad of [0, -5, 1.5, '100', null, undefined]) assert.ok(checkFileRequest({ ...ok, sizeBytes: bad }).errors.length > 0, String(bad));
});
test('documents need a type and cannot belong to a unit; other kinds cannot have a type', () => {
  assert.ok(checkFileRequest({ kind: 'document', mimeType: 'application/pdf', sizeBytes: 5 }).errors.length > 0);
  assert.ok(checkFileRequest({ kind: 'document', docType: 'other', unitId: '11111111-1111-1111-1111-111111111111', mimeType: 'application/pdf', sizeBytes: 5 }).errors.length > 0);
  assert.ok(checkFileRequest({ ...ok, docType: 'title_deed' }).errors.length > 0);
  assert.ok(checkFileRequest({ ...ok, unitId: 'not-an-id' }).errors.length > 0);
  assert.equal(checkFileRequest({ ...ok, unitId: '11111111-1111-1111-1111-111111111111' }).errors.length, 0);
});
test('display names are cleaned and never contain path characters', () => {
  assert.equal(cleanName('  ../../etc/passwd  '), '.._.._etc_passwd');
  assert.equal(cleanName('title\u0000deed.pdf'), 'titledeed.pdf');
  assert.equal(cleanName('a\\b/c'), 'a_b_c');
  assert.equal(cleanName('   '), undefined); assert.equal(cleanName(42), undefined);
  assert.equal(cleanName('x'.repeat(500))!.length, 120);
});
test('storage paths use only our ids and our chosen extension', () => {
  assert.equal(storagePath('o1', 'p1', 'f1', 'image/jpeg'), 'org/o1/property/p1/f1.jpg');
  assert.equal(storagePath('o1', 'p1', 'f1', 'application/pdf'), 'org/o1/property/p1/f1.pdf');
  assert.throws(() => storagePath('o1', 'p1', 'f1', 'text/html'));
});
