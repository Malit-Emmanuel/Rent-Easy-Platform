import test from 'node:test';
import assert from 'node:assert/strict';
import { sniffMime } from './sniff';

const bytes = (...n: number[]) => new Uint8Array(n);
const text = (s: string, pad = 0) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)).concat(new Array(pad).fill(0)));
test('recognises the allowed formats from their first bytes', () => {
  assert.equal(sniffMime(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 16)), 'image/jpeg');
  assert.equal(sniffMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0)), 'image/png');
  assert.equal(sniffMime(text('RIFF\0\0\0\0WEBPVP8 ')), 'image/webp');
  assert.equal(sniffMime(text('%PDF-1.7\n%')), 'application/pdf');
  assert.equal(sniffMime(Uint8Array.from([0, 0, 0, 24, ...text('ftypisom')])), 'video/mp4');
  assert.equal(sniffMime(Uint8Array.from([0, 0, 0, 20, ...text('ftypqt  ')])), 'video/quicktime');
  assert.equal(sniffMime(bytes(0x1a, 0x45, 0xdf, 0xa3, 1)), 'video/webm');
});
test('programs, scripts, archives, empty and short input are not recognised', () => {
  assert.equal(sniffMime(text('MZ\x90\x00\x03')), null);                 // Windows program
  assert.equal(sniffMime(text('<html><script>alert(1)</script>')), null);
  assert.equal(sniffMime(text('#!/bin/sh\nrm -rf /')), null);
  assert.equal(sniffMime(text('PK\x03\x04')), null);                      // zip
  assert.equal(sniffMime(new Uint8Array(0)), null);
  assert.equal(sniffMime(bytes(0xff, 0xd8)), null);
  assert.equal(sniffMime(text('%PDF')), null);                            // too short to be sure
});
test('a PNG header is not mistaken for anything else, and a fake RIFF is not WEBP', () => {
  assert.equal(sniffMime(text('RIFF\0\0\0\0WAVEfmt ')), null);
  assert.equal(sniffMime(bytes(0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0)), null);
});
