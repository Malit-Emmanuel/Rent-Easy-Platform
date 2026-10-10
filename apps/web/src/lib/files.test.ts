import test from 'node:test';
import assert from 'node:assert/strict';
import { completeError, fitWithin, formatBytes, preCheck, requestError } from './files';

test('fitWithin shrinks the long side and keeps the shape; small pictures are unchanged', () => {
  assert.deepEqual(fitWithin(4000, 3000, 1600), { width: 1600, height: 1200 });
  assert.deepEqual(fitWithin(3000, 4000, 1600), { width: 1200, height: 1600 });
  assert.deepEqual(fitWithin(800, 600, 1600), { width: 800, height: 600 });
  assert.deepEqual(fitWithin(1600, 1600, 1600), { width: 1600, height: 1600 });
  assert.deepEqual(fitWithin(10000, 1, 1600), { width: 1600, height: 1 });
});
test('formatBytes reads naturally', () => {
  assert.equal(formatBytes(512), '512 B'); assert.equal(formatBytes(2048), '2 KB'); assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB');
});
test('preCheck matches the server limits', () => {
  assert.equal(preCheck('photo', 'image/jpeg', 1000), null);
  assert.equal(preCheck('photo', 'video/mp4', 1000), 'err_wrongType');
  assert.equal(preCheck('photo', 'image/jpeg', 9 * 1024 * 1024), 'err_tooLarge');
  assert.equal(preCheck('document', 'application/pdf', 10 * 1024 * 1024), null);
  assert.equal(preCheck('video', 'video/mp4', 46 * 1024 * 1024), 'err_tooLarge');
  assert.equal(preCheck('document', 'text/html', 10), 'err_wrongType');
});
test('server answers map to clear messages', () => {
  assert.equal(requestError(409), 'err_limit'); assert.equal(requestError(503), 'err_storageOff'); assert.equal(requestError(500), 'genericError');
  assert.equal(completeError(422), 'err_rejected'); assert.equal(completeError(409), 'err_uploadFailed');
});
