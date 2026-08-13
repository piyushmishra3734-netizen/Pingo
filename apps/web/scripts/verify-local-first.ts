/**
 * The two pieces of arithmetic that decide whether history may be read from
 * this device instead of the server.
 *
 * Neither of them touches IndexedDB, which is the point. Both are string
 * ordering over storage keys, and string ordering is exactly the kind of thing
 * that is obviously right until a conversation is missing a fortnight out of
 * the middle of it and nothing anywhere reports an error.
 *
 * ## What is actually being defended
 *
 * The thread stops scrolling back when a page comes back shorter than it asked
 * for. So a local page that is short *ends history* as far as the reader is
 * concerned, and a local page that silently spans a gap deletes whatever was in
 * the gap. Both failures are invisible: no exception, no empty state, just a
 * conversation that is quietly wrong. These checks are the only thing standing
 * between that and a release.
 *
 * Run with `pnpm verify:local-first`.
 */
import { extendRun, messageRowKey, rowKeyBoundsBefore, type RowRun } from '../src/lib/local/db.js';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
};

const CONV = 'c1';

/** Message `n` of a conversation, one second apart, as it is keyed on disk. */
const key = (n: number) => messageRowKey(CONV, 1_700_000_000_000 + n * 1000, `m${n}`);

/** The keys a device would hold for messages `from..to`, in storage order. */
const held = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => key(from + i));

// -- keys sort the way the range reader assumes ----------------------------

check(
  [...held(1, 12)].sort().join() === held(1, 12).join(),
  'padded keys sort chronologically as strings, past ten',
);

check(
  messageRowKey(CONV, 999, 'x') < messageRowKey(CONV, 1000, 'x'),
  'a shorter timestamp still sorts before a longer one',
);

check(
  !messageRowKey('c10', 1, 'x').startsWith(`${CONV}|`),
  'one conversation id is not a prefix of another',
);

// -- what may be paged from disk -------------------------------------------

const keys = held(1, 100);

{
  const bounds = rowKeyBoundsBefore(CONV, keys, 'm50');
  check(bounds?.upper === key(50), 'the anchor is found by id, not by position');
  check(bounds?.lower === `${CONV}|`, 'with no floor, the range runs to the start');
}

check(
  rowKeyBoundsBefore(CONV, keys, 'm999') === undefined,
  'an anchor this device never stored is unanswerable, not answered from the top',
);

check(
  rowKeyBoundsBefore(CONV, keys, 'm50', key(60)) === undefined,
  'an anchor below the gapless floor is refused rather than served across the gap',
);

check(
  rowKeyBoundsBefore(CONV, keys, 'm50', key(50)) === undefined,
  'an anchor exactly at the floor is refused - there is nothing proven below it',
);

{
  const bounds = rowKeyBoundsBefore(CONV, keys, 'm50', key(20));
  check(bounds?.lower === key(20), 'above the floor, the floor is the lower bound');
}

// A conversation whose rows all belong to someone else's id must never be
// mistaken for this one's, however similar the ids look.
check(
  rowKeyBoundsBefore(CONV, held(1, 5).map((k) => k.replace('c1|', 'c11|')), 'm3') === undefined,
  'rows from a different conversation are not an answer',
);

// -- the gapless run -------------------------------------------------------

const run = (from: number, to: number): RowRun => ({ from: key(from), to: key(to) });
const same = (a: RowRun, b: RowRun) => a.from === b.from && a.to === b.to;

check(same(extendRun(undefined, run(50, 100)), run(50, 100)), 'the first page is the whole run');

check(
  same(extendRun(run(50, 100), run(40, 60)), run(40, 100)),
  'an overlapping stretch below extends the run downwards',
);

check(
  same(extendRun(run(50, 100), run(90, 140)), run(50, 140)),
  'an overlapping stretch above extends the run upwards',
);

check(
  same(extendRun(run(50, 100), run(60, 80)), run(50, 100)),
  'a stretch already inside the run changes nothing',
);

/*
 * The case this whole mechanism exists for.
 *
 * A month away from the app, then a page of the newest fifty. The two stretches
 * do not touch, and welding them together would let a reader page straight from
 * the new stretch into the old one, skipping every message in between and
 * showing no sign of it.
 */
check(
  same(extendRun(run(1, 50), run(500, 550)), run(500, 550)),
  'a stretch separated by a gap replaces the run instead of joining it',
);

check(
  same(extendRun(run(500, 550), run(1, 50)), run(1, 50)),
  'and the same when the new stretch is the older one - the run follows the newest fetch',
);

/*
 * Paging hands the anchor's own key as the top of the fetched stretch, because
 * the server returned exactly the rows below it. Without that, every page would
 * look one message short of the run and throw it away - the run would never
 * grow, and local paging would never once be used.
 */
{
  const anchored = extendRun(run(50, 100), { from: key(1), to: key(50) });
  check(same(anchored, run(1, 100)), 'a page anchored to the run joins it');
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
