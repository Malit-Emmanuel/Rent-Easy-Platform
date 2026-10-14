import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBedrooms, planImport } from './importer';

const nodes = [{ id: 1, name: 'Kilimani' }, { id: 2, name: 'Westlands' }];

test('bedrooms: numbers, words, bedsitters and studios are understood; nonsense is not', () => {
  for (const [s, n] of [['2', 2], ['2 BR', 2], ['2BR', 2], ['3 bedroom', 3], ['One bedroom', 1], ['two', 2], ['Bedsitter', 0], ['studio', 0], ['Single room', 0], [' 1 bd ', 1], ['0', 0]] as const)
    assert.equal(parseBedrooms(s), n, s);
  for (const s of ['', 'big', 'n/a', '-1']) assert.equal(parseBedrooms(s), null, s);
});

test('messy header names are recognised', () => {
  const p = planImport('Building Name,Street Address,Neighbourhood,House No.,Type,Lat,Long\nPalm Court,Argwings Kodhek Rd,Kilimani,A1,2 BR,-1.2921,36.7872', nodes);
  assert.equal(p.counts.errors, 0); assert.equal(p.properties[0].units[0].bedrooms, 2); assert.equal(p.properties[0].nodeId, 1); assert.equal(p.properties[0].latitude, -1.2921);
  assert.deepEqual(Object.values(p.headerMap).sort(), ['address', 'bedrooms', 'latitude', 'longitude', 'node', 'property', 'unit']);
});

test('rows of the same building are grouped into one property with several units', () => {
  const p = planImport('Property,Address,Unit,Bedrooms\nPalm Court,Kodhek Rd,A1,1\npalm  court,KODHEK RD,A2,2\nOther,Rd 2,1,0', nodes);
  assert.equal(p.counts.properties, 2); assert.equal(p.counts.units, 3); assert.equal(p.properties[0].units.length, 2);
});

test('a missing required column is one clear file-level error, not a row error for every row', () => {
  const p = planImport('Property,Unit,Bedrooms\nPalm Court,A1,2\nPalm Court,A2,2', nodes);
  assert.equal(p.issues.length, 1); assert.equal(p.issues[0].code, 'missing_column'); assert.equal(p.issues[0].column, 'address'); assert.equal(p.properties.length, 0);
});

test('row-level problems are reported with the spreadsheet row number', () => {
  const csv = ['Property,Address,Unit,Bedrooms,Latitude,Longitude',
    'Palm Court,Kodhek Rd,A1,2,,',                 // row 2 fine
    ',Kodhek Rd,A2,2,,',                           // row 3 missing property
    'Palm Court,Kodhek Rd,A3,big,,',               // row 4 bad bedrooms
    'Palm Court,Kodhek Rd,A1,1,,',                 // row 5 duplicate unit
    'Palm Court,Kodhek Rd,A4,1,36.8,-1.29',        // row 6 swapped position
    'Palm Court,Kodhek Rd,A5,1,-1.3,',             // row 7 one-sided position
    'Palm Court,Kodhek Rd,,1,,'].join('\n');       // row 8 missing unit label
  const p = planImport(csv, nodes);
  const by = (r: number) => p.issues.filter((i) => i.row === r && i.severity === 'error');
  assert.equal(by(2).length, 0); assert.equal(by(3)[0].column, 'property'); assert.equal(by(4)[0].column, 'bedrooms');
  assert.equal(by(5)[0].code, 'duplicate_unit'); assert.ok(by(5)[0].message.includes('row 2'));
  assert.ok(by(6)[0].message.includes('swapped')); assert.equal(by(7)[0].code, 'position'); assert.equal(by(8)[0].column, 'unit');
  assert.equal(p.counts.errors, 6); assert.equal(p.counts.units, 1);
});

test('an unknown area is a warning, not an error, and the area is left blank', () => {
  const p = planImport('Property,Address,Unit,Bedrooms,Area\nPalm Court,Kodhek Rd,A1,1,Narnia', nodes);
  assert.equal(p.counts.errors, 0); assert.equal(p.counts.warnings, 1); assert.equal(p.issues[0].code, 'unknown_area'); assert.equal(p.properties[0].nodeId, null);
});

test('conflicting details for the same building are warned about; the first row wins', () => {
  const p = planImport('Property,Address,Unit,Bedrooms,Area\nPalm Court,Kodhek Rd,A1,1,Kilimani\nPalm Court,Kodhek Rd,A2,1,Westlands', nodes);
  assert.equal(p.properties[0].nodeId, 1); assert.ok(p.issues.some((i) => i.code === 'conflict' && i.row === 3));
});

test('decimal commas in positions are understood', () => {
  const p = planImport('Property;Address;Unit;Bedrooms;Latitude;Longitude\nPalm Court;Kodhek Rd;A1;1;-1,2921;36,7872', nodes);
  assert.equal(p.counts.errors, 0); assert.equal(p.properties[0].longitude, 36.7872);
});

test('a 500-unit messy sheet with 12 planted defects reports exactly those 12 rows', () => {
  const lines = ['Estate,Location,Unit No,Beds,Area'];
  const bad = new Map<number, string>();
  for (let i = 0; i < 500; i++) {
    const row = i + 2, bld = `Block ${String.fromCharCode(65 + (i % 25))}`, unit = `U${i}`;
    let beds = ['bedsitter', '1', '2 BR', 'Two bedroom', '3'][i % 5], estate = bld, loc = `Road ${i % 25}`, label = unit;
    if (i % 41 === 7) { beds = 'many'; bad.set(row, 'bedrooms'); }
    else if (i % 83 === 11) { label = ''; bad.set(row, 'unit'); }
    else if (i % 97 === 13) { estate = ''; bad.set(row, 'property'); }
    lines.push(`${estate},${loc},${label},${beds},${i % 3 ? 'Kilimani' : 'Westlands'}`);
  }
  const p = planImport(lines.join('\r\n'), nodes);
  assert.equal(p.counts.rows, 500);
  const errRows = new Set(p.issues.filter((i) => i.severity === 'error').map((i) => i.row));
  assert.deepEqual([...errRows].sort((a, b) => a - b), [...bad.keys()].sort((a, b) => a - b));
  assert.equal(p.counts.errors, bad.size); assert.equal(p.counts.units, 500 - bad.size); assert.ok(p.counts.properties <= 25 * 25);
});
