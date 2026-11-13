import test from 'node:test';
import assert from 'node:assert/strict';
import { legalDoc, LEGAL_DOCS, type Lang } from './legal';

const langs: Lang[] = ['en', 'sw'];
const flat = (d: ReturnType<typeof legalDoc>) => d.blocks.flatMap((b) => [b.h, ...(b.p ?? []), ...(b.ul ?? []), ...(b.table ? [...b.table.head, ...b.table.rows.flat()] : [])]);

test('English and Swahili have the same shape', () => {
  for (const doc of LEGAL_DOCS) {
    const en = legalDoc(doc, 'en', {}), sw = legalDoc(doc, 'sw', {});
    assert.equal(en.blocks.length, sw.blocks.length);
    en.blocks.forEach((b, i) => {
      assert.equal(b.p?.length, sw.blocks[i].p?.length, `${doc} block ${i} paragraphs`);
      assert.equal(b.ul?.length, sw.blocks[i].ul?.length, `${doc} block ${i} list`);
      assert.equal(b.table?.rows.length, sw.blocks[i].table?.rows.length, `${doc} block ${i} table`);
    });
  }
});

test('no empty text', () => {
  for (const doc of LEGAL_DOCS) for (const l of langs) {
    const d = legalDoc(doc, l, { name: 'X' });
    d.blocks.forEach((b) => assert.ok(b.h.trim()));
    flat(d).filter((s) => s !== '').forEach((s) => assert.ok(s.trim()));
  }
});

test('unknown company details show as visible open points and the draft flag stays on', () => {
  for (const doc of LEGAL_DOCS) for (const l of langs) {
    const d = legalDoc(doc, l, { published: true });
    assert.ok(flat(d).some((s) => s.includes('[[')));
    assert.equal(d.draft, true);
    assert.ok(!flat(d).some((s) => /\{(company|reg|address|contact)\}/.test(s)));
  }
});

test('company details are filled in when known', () => {
  const d = legalDoc('privacy', 'en', { name: 'Acme Ltd', reg: 'PVT-1', address: 'Nairobi', contact: 'privacy@acme.test' });
  const text = flat(d).join(' ');
  assert.ok(text.includes('Acme Ltd') && text.includes('PVT-1') && text.includes('privacy@acme.test'));
});

test('never asserts unconfirmed facts as final', () => {
  const text = flat(legalDoc('privacy', 'en', {})).join(' ');
  assert.ok(text.includes('Lawyer to confirm'));
});
