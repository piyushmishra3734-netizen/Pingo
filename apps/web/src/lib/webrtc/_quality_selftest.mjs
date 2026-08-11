/**
 * Self-check for the call quality reader.
 *
 * Run: node apps/web/src/lib/webrtc/_quality_selftest.mjs
 *
 * The interesting part of `quality.ts` is not the stats it reads, it is the
 * differencing: `packetsLost` is cumulative, so the ratio has to be taken
 * between two samples or it describes the whole call instead of the last few
 * seconds. That is the kind of thing that is silently wrong forever - the
 * number still looks plausible - so it gets a check.
 *
 * No framework, because the repo has no runner and one assert file does not
 * justify adopting one.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { transform } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));

// esbuild's API rather than a build step: the type-only import of `@pingo/core`
// is erased, so the module runs on plain node with nothing else present.
const { code: js } = await transform(readFileSync(join(here, 'quality.ts'), 'utf8'), {
  loader: 'ts',
  format: 'esm',
});

const out = join(mkdtempSync(join(tmpdir(), 'pingo-quality-')), 'quality.mjs');
writeFileSync(out, js);
const { qualityReader } = await import(`file://${out}`);

/** A `getStats` report from plain objects - it only has to be iterable. */
const report = (rows) => ({ forEach: (fn) => rows.forEach(fn) });

const connection = (live) => ({ getStats: async () => report(live.rows) });

const audio = ({ lost, received, jitter = 0, bytesSent = 0, fractionLost = 0 }) => [
  { type: 'inbound-rtp', kind: 'audio', packetsLost: lost, packetsReceived: received, jitter, codecId: 'c1' },
  { type: 'outbound-rtp', kind: 'audio', bytesSent, codecId: 'c1' },
  { type: 'remote-inbound-rtp', kind: 'audio', fractionLost, roundTripTime: 0.05 },
  { type: 'codec', id: 'c1', mimeType: 'audio/opus' },
];

// One connection whose stats are swapped between samples, which is what a real
// one does - the reader must hold its own baseline across the calls.
const live = { rows: [] };
const reader = qualityReader(connection(live));

// --- the first sample only establishes a baseline -------------------------
live.rows = audio({ lost: 100, received: 900, bytesSent: 10_000 });
assert.equal(await reader(), undefined, 'first sample must report nothing');

// --- loss is measured over the interval, not the lifetime -----------------
// 10 more lost, 990 more received: 1% now, even though the call is at 10.9%
// cumulatively. The cumulative figure is the bug this exists to catch.
live.rows = audio({ lost: 110, received: 1890, bytesSent: 18_000 });
let q = await reader();
assert.ok(Math.abs(q.loss - 0.01) < 1e-9, `interval loss, got ${q.loss}`);
assert.equal(q.weak, false, '1% loss is not weak');
assert.equal(q.codec, 'audio/opus');
assert.ok(q.audioBitrate > 0, 'bitrate must be positive');

// --- a bad interval is reported even after a long clean call --------------
live.rows = audio({ lost: 210, received: 2790, bytesSent: 26_000 });
q = await reader();
assert.ok(Math.abs(q.loss - 0.1) < 1e-9, `10% in the interval, got ${q.loss}`);
assert.equal(q.weak, true, '10% loss must read as weak');

// --- the far end's view counts too, even when ours is clean ---------------
live.rows = audio({ lost: 210, received: 3790, bytesSent: 34_000, fractionLost: 0.08 });
q = await reader();
assert.ok(Math.abs(q.loss - 0.08) < 1e-9, 'worst direction wins');
assert.equal(q.weak, true);

// --- jitter alone is enough ------------------------------------------------
live.rows = audio({ lost: 210, received: 4790, bytesSent: 42_000, jitter: 0.05 });
q = await reader();
assert.equal(q.loss, 0, 'no loss in this interval');
assert.equal(q.weak, true, 'jitter alone must be enough');

// --- counters that reset must not produce negative loss -------------------
live.rows = audio({ lost: 0, received: 0, bytesSent: 0 });
q = await reader();
assert.ok(q.loss >= 0, 'a reset must not go negative');

console.log('quality reader: all checks passed');
