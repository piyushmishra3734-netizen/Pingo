/**
 * Turning the local database into an archive, and back, without holding either
 * in memory.
 *
 * ## Why two passes
 *
 * A chunk is bound to its position by additional authenticated data that
 * includes how many chunks there are, which is what stops one being lifted out
 * of an older archive or moved. Streaming does not know that number until the
 * last record has been read. Rather than weaken the binding, the source is read
 * twice: once to measure, once to seal. Reading the database again is cheap
 * beside the alternative of buffering an entire archive to learn its length.
 *
 * ## What is in it
 *
 * Newline-delimited JSON: a header, then one line per record, then a footer
 * carrying the count. Conversations, their messages, the row store and the sync
 * metadata - everything a device needs to show history without asking the
 * server. Media is deliberately excluded: it is the bulk of the bytes and none
 * of the conversation, and it can be fetched again.
 *
 * ## Plaintext exists only in transit
 *
 * Records are sealed at rest with *this* device's database key, which a
 * restoring device will never have, so they have to be opened and re-sealed
 * under the recovery key. The plaintext lives inside one chunk-sized buffer and
 * is gone as soon as that chunk is sealed. What leaves the device, and what
 * Drive stores, is ciphertext.
 */
import { openRecord, sealRecord } from '../crypto/session.js';
import { STORE, localEntries, localPutMany, type StoreName } from '../local/db.js';
import {
  archiveBase64,
  chunkAad,
  chunkDigest,
  deriveArchiveKey,
  importArchivePublicKey,
  type ArchiveChunk,
  type ArchiveManifest,
} from './drive/archive.js';

/** 4 MiB of plaintext per chunk, matching the non-streaming path. */
export const BUILDER_CHUNK_SIZE = 4 * 1024 * 1024;

/**
 * The stores worth carrying, and the order they are written in.
 *
 * `keys` is absent on purpose: it holds this device's identity, which must not
 * travel and which a restoring device generates for itself. `drafts` and
 * `outbox` are this device's unfinished business rather than history.
 */
export const ARCHIVED_STORES: StoreName[] = [
  STORE.conversations,
  STORE.messages,
  STORE.messageRows,
  STORE.meta,
];

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface ArchiveStats {
  records: number;
  /**
   * Records the source could not open.
   *
   * Never ignore a non-zero value. It means the archive is missing history the
   * device is holding, and the first time it was measured on a real database it
   * was 50 out of 52.
   */
  skipped: number;
  plaintextBytes: number;
  sealedBytes: number;
  chunks: number;
  /** Largest buffer held at once, which is the number that matters on a phone. */
  peakBufferBytes: number;
  millis: number;
}

/**
 * Everything the archive will contain, one line at a time.
 *
 * An async generator rather than an array: the whole point is that the caller
 * never has all of it.
 */
export async function* archiveLines(
  stores: StoreName[] = ARCHIVED_STORES,
): AsyncGenerator<Uint8Array> {
  yield encoder.encode(
    `${JSON.stringify({ kind: 'header', version: 1, createdAt: Date.now(), stores })}\n`,
  );

  let records = 0;
  let skipped = 0;
  for (const store of stores) {
    let entries: Array<[string, unknown]>;
    try {
      entries = await localEntries<unknown>(store);
    } catch {
      // A store that does not exist on this schema version is not a failure;
      // it is simply nothing to carry.
      continue;
    }

    for (const [key, sealed] of entries) {
      /*
       * Opened here and re-sealed by the chunk. A record that will not open is
       * skipped rather than aborting the whole archive: one unreadable row
       * should not cost somebody every other conversation they have.
       *
       * Skipping quietly is the dangerous part, and it was. On a real device
       * 50 of 52 records failed to open - rows left behind by an account
       * switch, sealed under a key this device no longer held - and the archive
       * reported success having carried almost nothing. The count travels in
       * the footer now, and the caller is expected to look at it.
       */
      const value = await openRecord<unknown>(sealed).catch(() => undefined);
      if (value === undefined) {
        skipped += 1;
        continue;
      }

      records += 1;
      yield encoder.encode(`${JSON.stringify({ kind: 'record', store, key, value })}\n`);
    }
  }

  yield encoder.encode(`${JSON.stringify({ kind: 'end', records, skipped })}\n`);
}

/** Pass one: how long is it? Nothing is sealed and nothing is kept. */
export async function measureArchive(
  source: () => AsyncGenerator<Uint8Array>,
): Promise<number> {
  let total = 0;
  for await (const line of source()) total += line.length;
  return total;
}

/**
 * Pass two: seal chunk by chunk, handing each one off immediately.
 *
 * `onChunk` is awaited, so a caller that uploads there applies natural
 * backpressure and the builder never runs ahead of the network.
 */
export async function buildArchive(
  recoveryPublicKey: string,
  generation: number,
  onChunk: (chunk: ArchiveChunk) => Promise<void>,
  source: () => AsyncGenerator<Uint8Array> = () => archiveLines(),
  chunkSize = BUILDER_CHUNK_SIZE,
): Promise<{ manifest: ArchiveManifest; stats: ArchiveStats }> {
  const started = Date.now();

  const totalBytes = await measureArchive(source);
  const chunkCount = Math.max(1, Math.ceil(totalBytes / chunkSize));

  const theirs = await importArchivePublicKey(recoveryPublicKey);
  const ephemeral = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ]);
  const key = await deriveArchiveKey(ephemeral.privateKey, theirs, ['encrypt']);

  const meta: ArchiveManifest['chunks'] = [];
  let buffer = new Uint8Array(chunkSize);
  let filled = 0;
  let index = 0;
  let sealedBytes = 0;
  let peak = 0;
  let records = 0;
  let skipped = 0;

  const sealChunk = async () => {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const slice = buffer.subarray(0, filled);
    const sealed = new Uint8Array(
      await crypto.subtle.encrypt(
        {
          name: 'AES-GCM',
          iv,
          additionalData: chunkAad(generation, index, chunkCount) as unknown as ArrayBuffer,
        },
        key,
        slice as unknown as ArrayBuffer,
      ),
    );

    meta.push({ index, iv: archiveBase64(iv), digest: await chunkDigest(sealed), bytes: sealed.length });
    sealedBytes += sealed.length;
    peak = Math.max(peak, buffer.length + sealed.length);

    await onChunk({ index, bytes: sealed });
    index += 1;
    filled = 0;
  };

  for await (const line of source()) {
    /*
     * The footer carries the real counts. Counting every line would include the
     * header and footer and, far worse, would not know how many records the
     * source declined to open - which is the number that says whether this
     * archive is worth having.
     */
    if (line.length > 0 && line[0] === 0x7b) {
      const text = decoder.decode(line);
      if (text.startsWith('{"kind":"record"')) {
        records += 1;
      } else if (text.startsWith('{"kind":"end"')) {
        try {
          skipped = (JSON.parse(text.trim()) as { skipped?: number }).skipped ?? 0;
        } catch {
          /* a footer we cannot read leaves the count at zero */
        }
      }
    }

    let offset = 0;
    while (offset < line.length) {
      const room = chunkSize - filled;
      const take = Math.min(room, line.length - offset);
      buffer.set(line.subarray(offset, offset + take), filled);
      filled += take;
      offset += take;
      if (filled === chunkSize) await sealChunk();
    }
  }

  // The tail, and the empty case: an archive with no records is still one chunk.
  if (filled > 0 || index === 0) await sealChunk();

  return {
    manifest: {
      version: 1,
      generation,
      epk: archiveBase64(new Uint8Array(await crypto.subtle.exportKey('spki', ephemeral.publicKey))),
      chunkCount: index,
      totalBytes,
      chunks: meta,
      createdAt: Date.now(),
    },
    stats: {
      records,
      skipped,
      plaintextBytes: totalBytes,
      sealedBytes,
      chunks: index,
      peakBufferBytes: peak,
      millis: Date.now() - started,
    },
  };
}

export interface RestoreStats {
  records: number;
  stores: number;
  millis: number;
}

/**
 * Rebuild the local database from an archive, one chunk at a time.
 *
 * Records are re-sealed with *this* device's key as they land, so what was
 * readable only by the recovery key becomes readable by the device that now
 * holds it. Writing is batched per store because a transaction per record for
 * ten thousand messages is the difference between a moment and a minute.
 *
 * Idempotent by construction: every store is keyed by its natural id, so
 * restoring the same archive twice updates rather than accumulates.
 */
/**
 * Where a restore puts things.
 *
 * Injected because the sealed IndexedDB store is a browser thing and this logic
 * is not - the same reason the enrolment state store is injected. Verification
 * supplies an in-memory one and exercises the real chunking, the real carry
 * across boundaries and the real crypto.
 */
export interface RestoreSink {
  put(store: StoreName, entries: Array<[string, unknown]>): Promise<void>;
  seal(value: unknown): Promise<unknown>;
}

export const localRestoreSink: RestoreSink = {
  put: (store, entries) => localPutMany(store, entries),
  seal: (value) => sealRecord(value),
};

/**
 * Write an already-decrypted archive into the database.
 *
 * Split out because there are two ways to arrive here with the same bytes: the
 * chunk-by-chunk restore below, which decrypts as it goes, and the Drive path,
 * where the target has already downloaded, verified and assembled the archive.
 * Having the second one decrypt again would be wasteful; having it parse and
 * write through a second implementation would be worse, because the two would
 * eventually disagree about what a record is.
 */
export async function applyArchivePlaintext(
  plaintext: Uint8Array,
  sink: RestoreSink = localRestoreSink,
): Promise<RestoreStats> {
  const started = Date.now();
  const pending = new Map<StoreName, Array<[string, unknown]>>();
  let records = 0;

  const flush = async (store: StoreName) => {
    const batch = pending.get(store);
    if (!batch?.length) return;
    await sink.put(store, batch);
    pending.set(store, []);
  };

  for (const line of decoder.decode(plaintext).split('\n')) {
    if (!line.trim()) continue;
    let parsed: { kind: string; store?: StoreName; key?: string; value?: unknown };
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (parsed.kind !== 'record' || !parsed.store || parsed.key === undefined) continue;

    const batch = pending.get(parsed.store) ?? [];
    batch.push([parsed.key, await sink.seal(parsed.value)]);
    pending.set(parsed.store, batch);
    records += 1;
    if (batch.length >= 500) await flush(parsed.store);
  }

  for (const store of pending.keys()) await flush(store);
  return { records, stores: pending.size, millis: Date.now() - started };
}

export async function restoreArchiveInto(
  chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
  manifest: ArchiveManifest,
  recoveryPrivateKey: CryptoKey,
  sink: RestoreSink = localRestoreSink,
): Promise<RestoreStats> {
  const started = Date.now();
  const epk = await importArchivePublicKey(manifest.epk);
  const key = await deriveArchiveKey(recoveryPrivateKey, epk, ['decrypt']);

  let index = 0;
  let carry = '';
  let records = 0;
  const pending = new Map<StoreName, Array<[string, unknown]>>();

  const flush = async (store: StoreName) => {
    const batch = pending.get(store);
    if (!batch?.length) return;
    await sink.put(store, batch);
    pending.set(store, []);
  };

  const handle = async (line: string) => {
    if (!line.trim()) return;
    const parsed = JSON.parse(line) as {
      kind: string;
      store?: StoreName;
      key?: string;
      value?: unknown;
    };
    if (parsed.kind !== 'record' || !parsed.store || parsed.key === undefined) return;

    const batch = pending.get(parsed.store) ?? [];
    batch.push([parsed.key, await sink.seal(parsed.value)]);
    pending.set(parsed.store, batch);
    records += 1;

    if (batch.length >= 500) await flush(parsed.store);
  };

  for await (const sealed of chunks as AsyncIterable<Uint8Array>) {
    const entry = manifest.chunks[index];
    if (!entry) throw new Error(`Archive has more parts than its index describes.`);

    const opened = new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: Uint8Array.from(atob(entry.iv), (c) => c.charCodeAt(0)) as unknown as ArrayBuffer,
          additionalData: chunkAad(
            manifest.generation,
            entry.index,
            manifest.chunkCount,
          ) as unknown as ArrayBuffer,
        },
        key,
        sealed as unknown as ArrayBuffer,
      ),
    );

    /*
     * A record can straddle a chunk boundary, so the tail of one chunk is held
     * until the next arrives. Splitting on newlines without carrying would
     * quietly drop whichever message the boundary happened to land in.
     */
    carry += decoder.decode(opened, { stream: true });
    const lines = carry.split('\n');
    carry = lines.pop() ?? '';
    for (const line of lines) await handle(line);

    index += 1;
  }

  if (carry.trim()) await handle(carry);
  for (const store of pending.keys()) await flush(store);

  return { records, stores: pending.size, millis: Date.now() - started };
}
