/**
 * The archive builder: does it carry a real database, and at what cost?
 *
 * Real crypto, real chunking, real line-carrying across chunk boundaries. The
 * two things standing in are the source (an in-memory database rather than
 * IndexedDB) and the sink, both injected through the interfaces the shipping
 * code uses.
 *
 * The measurements at the end are the point of the exercise. "Streamable" is a
 * claim about memory, and a claim about memory that nobody measured is a hope.
 *
 * Run with `pnpm verify:archive-builder`.
 */
import {
  buildArchive,
  restoreArchiveInto,
  type RestoreSink,
} from '../src/lib/backup/archive-builder.js';
import type { ArchiveChunk } from '../src/lib/backup/drive/archive.js';
import type { StoreName } from '../src/lib/local/db.js';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
};

const encoder = new TextEncoder();

const recovery = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
  'deriveKey',
  'deriveBits',
]);
const recoveryPublic = Buffer.from(
  new Uint8Array(await crypto.subtle.exportKey('spki', recovery.publicKey)),
).toString('base64');

/** A believable local database: conversations plus their messages. */
function database(chats: number, messagesPerChat: number) {
  const records: Array<{ store: StoreName; key: string; value: unknown }> = [];

  for (let c = 0; c < chats; c += 1) {
    const id = `conv-${String(c).padStart(6, '0')}`;
    records.push({
      store: 'conversations' as StoreName,
      key: id,
      value: {
        id,
        kind: c % 5 === 0 ? 'group' : 'direct',
        title: `Conversation ${c}`,
        lastMessageAt: 1_700_000_000_000 + c * 1000,
        unread: c % 7,
        pinned: c % 11 === 0,
        muted_until: null,
      },
    });

    for (let m = 0; m < messagesPerChat; m += 1) {
      records.push({
        store: 'message-rows' as StoreName,
        key: `${id}|${String(1_700_000_000_000 + m).padStart(15, '0')}|msg-${c}-${m}`,
        value: {
          id: `msg-${c}-${m}`,
          conversation_id: id,
          sender_id: m % 2 ? 'me' : 'them',
          body: `Message ${m} in conversation ${c}. ${'x'.repeat(40)}`,
          created_at: new Date(1_700_000_000_000 + m).toISOString(),
          edited_at: null,
          kind: 'text',
          encryption: m % 3 === 0 ? 'v1' : null,
          envelope: m % 3 === 0 ? { epk: 'e', iv: 'i', keys: { 'device-1': { iv: 'a', key: 'b' } } } : null,
        },
      });
    }
  }

  records.push({
    store: 'meta' as StoreName,
    key: 'startup',
    value: { conversations: chats, savedAt: Date.now() },
  });

  return records;
}

const sourceOf = (records: ReturnType<typeof database>) =>
  async function* () {
    yield encoder.encode(`${JSON.stringify({ kind: 'header', version: 1, createdAt: 0 })}\n`);
    for (const record of records) {
      yield encoder.encode(`${JSON.stringify({ kind: 'record', ...record })}\n`);
    }
    yield encoder.encode(`${JSON.stringify({ kind: 'end', records: records.length })}\n`);
  };

/** An in-memory database to restore into, plus a seal that is really applied. */
function sink() {
  const stores = new Map<string, Map<string, unknown>>();
  let sealed = 0;
  const impl: RestoreSink = {
    async put(store, entries) {
      const bucket = stores.get(store) ?? new Map<string, unknown>();
      for (const [key, value] of entries) bucket.set(key, value);
      stores.set(store, bucket);
    },
    async seal(value) {
      sealed += 1;
      return { sealed: true, value };
    },
  };
  return {
    impl,
    stores,
    get sealCount() {
      return sealed;
    },
    count: () => [...stores.values()].reduce((sum, bucket) => sum + bucket.size, 0),
  };
}

const collect = async (records: ReturnType<typeof database>, chunkSize = 1024 * 1024) => {
  const chunks: ArchiveChunk[] = [];
  const { manifest, stats } = await buildArchive(
    recoveryPublic,
    1,
    async (chunk) => {
      chunks.push({ index: chunk.index, bytes: chunk.bytes });
    },
    sourceOf(records),
    chunkSize,
  );
  return { chunks, manifest, stats };
};

console.log('— empty archive —');

const empty = await collect([]);
check(empty.manifest.chunkCount === 1, 'an empty database is still one chunk');
check(empty.chunks.length === 1, 'and one chunk is emitted');

const emptySink = sink();
const emptyRestore = await restoreArchiveInto(
  empty.chunks.map((c) => c.bytes),
  empty.manifest,
  recovery.privateKey,
  emptySink.impl,
);
check(emptyRestore.records === 0, 'restoring it produces no records');
check(emptySink.count() === 0, 'and writes nothing');

console.log('\n— 10 chats —');

const ten = await collect(database(10, 20));
const tenSink = sink();
const tenRestore = await restoreArchiveInto(
  ten.chunks.map((c) => c.bytes),
  ten.manifest,
  recovery.privateKey,
  tenSink.impl,
);
check(tenRestore.records === 10 + 200 + 1, `all ${tenRestore.records} records restored`);
check(tenSink.stores.get('conversations')?.size === 10, '10 conversations rebuilt');
check(tenSink.stores.get('message-rows')?.size === 200, '200 messages rebuilt');
check(tenSink.stores.get('meta')?.size === 1, 'metadata rebuilt');

/*
 * Encryption metadata has to survive, or a restored message that was encrypted
 * would be indistinguishable from one that never was.
 */
const sampleKey = [...tenSink.stores.get('message-rows')!.keys()].find((k) => k.includes('msg-0-0'))!;
const sample = tenSink.stores.get('message-rows')!.get(sampleKey) as { value: { encryption: unknown; envelope: unknown } };
check(sample.value.encryption === 'v1', 'encryption metadata survives the round trip');
check(sample.value.envelope !== null, 'and so does the envelope');

console.log('\n— 100 chats —');

const hundred = await collect(database(100, 20));
const hundredSink = sink();
await restoreArchiveInto(
  hundred.chunks.map((c) => c.bytes),
  hundred.manifest,
  recovery.privateKey,
  hundredSink.impl,
);
check(hundredSink.stores.get('conversations')?.size === 100, '100 conversations rebuilt');
check(hundredSink.stores.get('message-rows')?.size === 2000, '2,000 messages rebuilt');
/*
 * 100 chats is still under a megabyte, so it is one chunk — asserted as such
 * rather than assumed to be many. The multi-chunk path is exercised by the
 * 10,000-message archive below and by the deliberately tiny chunks after it.
 */
check(
  hundred.manifest.chunkCount === Math.max(1, Math.ceil(hundred.stats.plaintextBytes / (1024 * 1024))),
  `chunk count matches the size: ${hundred.manifest.chunkCount} for ${(hundred.stats.plaintextBytes / 1024).toFixed(0)} KB`,
);

console.log('\n— 10,000 messages —');

const heapBefore = process.memoryUsage().heapUsed;
const big = await collect(database(20, 500));
const heapAfterBuild = process.memoryUsage().heapUsed;

const bigSink = sink();
const bigRestore = await restoreArchiveInto(
  big.chunks.map((c) => c.bytes),
  big.manifest,
  recovery.privateKey,
  bigSink.impl,
);
check(bigSink.stores.get('message-rows')?.size === 10_000, '10,000 messages rebuilt');
check(bigSink.stores.get('conversations')?.size === 20, 'with their 20 conversations');
check(bigRestore.records === 10_021, `${bigRestore.records} records total`);

console.log('\n— records straddling a chunk boundary —');

/*
 * A tiny chunk forces records to be split across boundaries. Without the carry
 * in the restorer, whichever message the boundary landed in would vanish.
 */
const tiny = await collect(database(5, 40), 4096);
check(tiny.manifest.chunkCount > 5, `forced into ${tiny.manifest.chunkCount} small chunks`);
const tinySink = sink();
const tinyRestore = await restoreArchiveInto(
  tiny.chunks.map((c) => c.bytes),
  tiny.manifest,
  recovery.privateKey,
  tinySink.impl,
);
check(tinyRestore.records === 5 + 200 + 1, 'every record survives being split across chunks');
check(tinySink.stores.get('message-rows')?.size === 200, 'no message is lost at a boundary');

console.log('\n— interrupted generation —');

let emitted = 0;
let interrupted = false;
try {
  await buildArchive(
    recoveryPublic,
    2,
    async () => {
      emitted += 1;
      if (emitted === 2) throw new Error('connection lost');
    },
    sourceOf(database(50, 20)),
    64 * 1024,
  );
} catch {
  interrupted = true;
}
check(interrupted, 'a failing upload stops the build');
check(emitted === 2, 'and it stops at the chunk that failed rather than sealing the rest');

console.log('\n— corrupted archive —');

const corrupt = await collect(database(10, 20));
const damaged = corrupt.chunks.map((c, i) =>
  i === 0 ? new Uint8Array(c.bytes) : c.bytes,
);
damaged[0]![500] ^= 0xff;

let rejected = false;
try {
  await restoreArchiveInto(damaged, corrupt.manifest, recovery.privateKey, sink().impl);
} catch {
  rejected = true;
}
check(rejected, 'a corrupted chunk is refused rather than partially restored');

console.log('\n— duplicate conversations —');

const dupes = database(3, 5);
dupes.push({
  store: 'conversations' as StoreName,
  key: 'conv-000000',
  value: { id: 'conv-000000', title: 'Renamed later', lastMessageAt: 9_999_999_999_999 },
});
const dupeBuild = await collect(dupes);
const dupeSink = sink();
await restoreArchiveInto(
  dupeBuild.chunks.map((c) => c.bytes),
  dupeBuild.manifest,
  recovery.privateKey,
  dupeSink.impl,
);
check(dupeSink.stores.get('conversations')?.size === 3, 'a duplicated key does not create a second conversation');
const survivor = dupeSink.stores.get('conversations')!.get('conv-000000') as { value: { title: string } };
check(survivor.value.title === 'Renamed later', 'and the later record wins');

console.log('\n— skipped records are counted, not hidden —');

/*
 * The failure this exists to prevent: on a real device 50 of 52 records would
 * not open, and the archive reported success having carried two of them.
 */
const withUnreadable = async function* () {
  yield encoder.encode(`${JSON.stringify({ kind: 'header', version: 1 })}\n`);
  yield encoder.encode(
    `${JSON.stringify({ kind: 'record', store: 'conversations', key: 'a', value: { id: 'a' } })}\n`,
  );
  yield encoder.encode(`${JSON.stringify({ kind: 'end', records: 1, skipped: 49 })}\n`);
};

const counted = await buildArchive(recoveryPublic, 1, async () => {}, withUnreadable, 1024 * 1024);
check(counted.stats.records === 1, 'one record carried');
check(counted.stats.skipped === 49, 'and forty-nine reported as skipped rather than ignored');
check(ten.stats.skipped === 0, 'a healthy database reports nothing skipped');

console.log('\n— idempotent restore —');

const onceSink = sink();
await restoreArchiveInto(ten.chunks.map((c) => c.bytes), ten.manifest, recovery.privateKey, onceSink.impl);
const afterOnce = onceSink.count();
await restoreArchiveInto(ten.chunks.map((c) => c.bytes), ten.manifest, recovery.privateKey, onceSink.impl);
const afterTwice = onceSink.count();
check(afterOnce === afterTwice, `restoring twice leaves ${afterTwice} records, not ${afterOnce * 2}`);

console.log('\n— measured —');

const rows = [
  ['empty', empty],
  ['10 chats / 200 msgs', ten],
  ['100 chats / 2,000 msgs', hundred],
  ['20 chats / 10,000 msgs', big],
] as const;

console.log(
  `\n${'archive'.padEnd(24)}${'plaintext'.padStart(12)}${'sealed'.padStart(12)}${'chunks'.padStart(8)}${'build'.padStart(9)}${'peak buf'.padStart(11)}`,
);
for (const [name, built] of rows) {
  const s = built.stats;
  console.log(
    name.padEnd(24) +
      `${(s.plaintextBytes / 1024).toFixed(0)} KB`.padStart(12) +
      `${(s.sealedBytes / 1024).toFixed(0)} KB`.padStart(12) +
      String(s.chunks).padStart(8) +
      `${s.millis} ms`.padStart(9) +
      `${(s.peakBufferBytes / 1024).toFixed(0)} KB`.padStart(11),
  );
}

console.log(`\nrestore, 10,000 messages : ${bigRestore.millis} ms`);
console.log(`overhead, sealed vs plain: ${((big.stats.sealedBytes / big.stats.plaintextBytes - 1) * 100).toFixed(2)}%`);
console.log(`heap growth during build : ${((heapAfterBuild - heapBefore) / 1024 / 1024).toFixed(1)} MB`);
console.log(`peak buffer held         : ${(big.stats.peakBufferBytes / 1024 / 1024).toFixed(2)} MB (chunk size 1 MB)`);

/*
 * The claim being checked: memory is bounded by the chunk size, not by the
 * archive. If this ever fails, "streamable" has stopped being true.
 */
check(
  big.stats.peakBufferBytes < 4 * 1024 * 1024,
  'peak buffer stays near the chunk size, not the archive size',
);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
