/**
 * Notes, the parts with a right answer: how long a note may be (as a person
 * counts it, emoji included), what is left of its 24 hours, and that the
 * backgrounds the app offers are exactly the ones the database accepts.
 *
 *   pnpm verify:notes   (from the repo root)
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

Object.assign(globalThis, { window: globalThis, document: { addEventListener() {}, removeEventListener() {} } });

const { NOTE_BGS, NOTE_MAX, clampNote, noteBg, noteLength, timeLeft } = await import('../src/features/notes/notes.js');

let checks = 0;
const check = (name: string, run: () => void) => {
  run();
  checks += 1;
  console.log('PASS ', name);
};

check('a note is at most 100 characters', () => {
  assert.equal(NOTE_MAX, 100);
  assert.equal(noteLength('a'.repeat(100)), 100);
  assert.equal(clampNote('a'.repeat(150)).length, 100);
});

check('an emoji counts as one character, and is never cut in half', () => {
  assert.equal(noteLength('😀'), 1);
  assert.equal(noteLength('hi 🙂'), 4);
  const clamped = clampNote('😀'.repeat(150));
  assert.equal(noteLength(clamped), 100);
  assert.ok(!/[\ud800-\udbff]$/.test(clamped), 'no dangling half of a pair');
  // A family emoji is several code points joined: still never split into a broken glyph pair.
  assert.equal(noteLength(clampNote('x'.repeat(99) + '😀😀')), 100);
});

check('what is left of 24 hours reads plainly', () => {
  const now = Date.UTC(2026, 9, 24, 12, 0, 0);
  const at = (minutes: number) => now + minutes * 60_000;
  assert.equal(timeLeft(at(24 * 60), now), '24h left');
  assert.equal(timeLeft(at(21 * 60 + 10), now), '21h left');
  assert.equal(timeLeft(at(90), now), '2h left');
  assert.equal(timeLeft(at(40), now), '40m left');
  assert.equal(timeLeft(at(1), now), 'ending now');
  assert.equal(timeLeft(at(-5), now), 'ending now');
});

check('the backgrounds offered are exactly the ones the database accepts', () => {
  const sql = readFileSync('supabase/migrations/20261112000000_notes.sql', 'utf8');
  const listed = /bg in \(([^)]*)\)/.exec(sql)![1]!.split(',').map((s) => s.trim().replace(/'/g, ''));
  assert.deepEqual(NOTE_BGS.map((b) => b.id).sort(), [...listed].sort());
  assert.equal(NOTE_BGS[0]!.id, 'default', 'plain comes first and is the default');
});

check('every tinted background is dark and readable', () => {
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
    const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a: string, b: string) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
    return (hi + 0.05) / (lo + 0.05);
  };
  for (const b of NOTE_BGS.filter((x) => x.bg)) {
    assert.ok(lum(b.bg) < 0.05, `${b.id} is a dark tint`);
    assert.ok(ratio(b.bg, b.ink) >= 7, `${b.id} text has ${ratio(b.bg, b.ink).toFixed(1)}:1 contrast`);
  }
});

check('an unknown background falls back to plain', () => {
  assert.equal(noteBg('neon').id, 'default');
  assert.equal(noteBg(undefined).id, 'default');
  assert.equal(noteBg('rose').id, 'rose');
});

console.log(`\nAll ${checks} notes checks passed.`);
