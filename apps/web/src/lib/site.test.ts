import test from 'node:test';
import assert from 'node:assert/strict';
import { SITE, SITE_NAMES } from './site';

const texts = (d: (typeof SITE)['welcome']['en']) => [d.title, d.lead, d.cta, d.ctaMore, ...d.sections.flatMap((s) => [s.h, s.intro ?? '', ...(s.items?.flatMap((i) => [i.h, i.p]) ?? []), ...(s.list ?? [])])].filter(Boolean);

test('English and Swahili pages have the same shape', () => {
  for (const n of SITE_NAMES) {
    const en = SITE[n].en, sw = SITE[n].sw;
    assert.equal(en.sections.length, sw.sections.length);
    en.sections.forEach((s, i) => { assert.equal(s.items?.length, sw.sections[i].items?.length); assert.equal(s.list?.length, sw.sections[i].list?.length); assert.equal(!!s.intro, !!sw.sections[i].intro); });
  }
});

test('no empty text', () => { for (const n of SITE_NAMES) for (const l of ['en', 'sw'] as const) texts(SITE[n][l]).forEach((t) => assert.ok(t.trim().length > 2)); });

test('public pages make no promises we cannot keep: no figures, no times, no unbuilt feature described as working', () => {
  for (const n of SITE_NAMES) {
    const all = texts(SITE[n].en).join(' ');
    assert.ok(!/\d/.test(all.replace(/^[1-4]\. /gm, '').replace(/\b[1-4]\. /g, '')), 'no numbers other than step numbers');
    assert.ok(!/\b(within|in under|same[- ]day|instantly|guarantee[sd]?)\b/i.test(all.replace(/not a guarantee of/gi, '')), 'no promised times or guarantees');
    assert.ok(!/(testimonial|trusted by|customers love|thousands|million)/i.test(all));
  }
  const v = texts(SITE.verified.en).join(' ');
  assert.ok(/not a guarantee/i.test(v) && /coming later/i.test(v) && /switched off/i.test(v), 'states the limits and that video is not live');
  assert.ok(/not ready yet/i.test(texts(SITE.welcome.en).join(' ')), 'says tenant and buyer features are not ready');
});
