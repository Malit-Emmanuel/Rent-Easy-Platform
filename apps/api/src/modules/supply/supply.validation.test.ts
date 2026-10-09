import test from 'node:test';
import assert from 'node:assert/strict';
import { checkProperty, checkUnit, pageLimit } from './supply.validation';

test('property: create needs name and address; whitespace is tidied', () => {
  assert.deepEqual(checkProperty({ name: '  Palm   Court ', addressText: ' Argwings Kodhek Rd ' }, 'create').value, { name: 'Palm Court', addressText: 'Argwings Kodhek Rd' });
  assert.ok(checkProperty({}, 'create').errors.length === 2);
  assert.ok(checkProperty({ name: 'x', addressText: 'ok road' }, 'create').errors[0].includes('name'));
  assert.ok(checkProperty({ name: 'a'.repeat(121), addressText: 'ok road' }, 'create').errors.length === 1);
  assert.ok(checkProperty(null, 'create').errors.length === 2);
});
test('property: update accepts partial changes, rejects empty ones', () => {
  assert.deepEqual(checkProperty({ name: 'New Name' }, 'update').value, { name: 'New Name' });
  assert.ok(checkProperty({}, 'update').errors.includes('nothing to update'));
});
test('position: valid Kenyan point accepted; both-null clears; one-sided and non-numbers rejected', () => {
  assert.deepEqual(checkProperty({ latitude: -1.29, longitude: 36.8 }, 'update').value, { latitude: -1.29, longitude: 36.8 });
  assert.deepEqual(checkProperty({ latitude: null, longitude: null }, 'update').value, { latitude: null, longitude: null });
  assert.ok(checkProperty({ latitude: -1.29 }, 'update').errors.length === 1);
  assert.ok(checkProperty({ latitude: '1', longitude: '2' }, 'update').errors.length === 1);
  assert.ok(checkProperty({ latitude: NaN, longitude: 36 }, 'update').errors.length === 1);
});
test('position: swapped and out-of-Kenya points get clear messages', () => {
  assert.equal(checkProperty({ latitude: 36.8, longitude: -1.29 }, 'update').errors[0], 'latitude and longitude look swapped');
  assert.equal(checkProperty({ latitude: 51.5, longitude: -0.12 }, 'update').errors[0], 'the position is outside Kenya');
});
test('nodeId: whole positive number or null', () => {
  assert.deepEqual(checkProperty({ nodeId: 3 }, 'update').value, { nodeId: 3 });
  assert.deepEqual(checkProperty({ nodeId: null }, 'update').value, { nodeId: null });
  assert.ok(checkProperty({ nodeId: 0 }, 'update').errors.length === 1);
  assert.ok(checkProperty({ nodeId: '3' }, 'update').errors.length === 1);
});
test('unit: label and bedrooms rules (0 bedrooms is valid)', () => {
  assert.deepEqual(checkUnit({ label: ' A1 ', bedrooms: 0 }, 'create').value, { label: 'A1', bedrooms: 0 });
  assert.ok(checkUnit({ label: '', bedrooms: 1 }, 'create').errors.length === 1);
  assert.ok(checkUnit({ label: 'A1', bedrooms: 1.5 }, 'create').errors.length === 1);
  assert.ok(checkUnit({ label: 'A1', bedrooms: -1 }, 'create').errors.length === 1);
  assert.ok(checkUnit({ label: 'A1', bedrooms: 21 }, 'create').errors.length === 1);
  assert.ok(checkUnit({}, 'update').errors.includes('nothing to update'));
});
test('page limit defaults to 100 and is capped at 200', () => {
  assert.equal(pageLimit(undefined), 100); assert.equal(pageLimit('50'), 50); assert.equal(pageLimit('9999'), 200); assert.equal(pageLimit('-3'), 100); assert.equal(pageLimit('abc'), 100);
});
