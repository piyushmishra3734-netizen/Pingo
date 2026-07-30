/**
 * The archive builder, run against this device's real database.
 *
 * Everything else about the builder is verified with an injected source and
 * sink, which is the right way to test chunking and carry logic but says
 * nothing about the two functions that actually touch IndexedDB and the device
 * key. `archiveLines` and `localRestoreSink` are the shipping paths and had
 * never executed in a browser; this is what runs them.
 *
 * ## Why restoring into the same database is safe
 *
 * The archive is built from this database, so restoring it writes the same
 * records back under the same natural keys. The values are re-sealed and
 * therefore differ byte for byte — new IV each time — but decrypt to what was
 * already there. That makes the round trip a genuine exercise of the write
 * path without being destructive, and it is exactly the idempotence claim
 * being checked.
 *
 * Reachable from the console rather than from any screen. It reads, writes back
 * what it read, and reports numbers.
 */
import { openRecord } from '../crypto/session.js';
import { STORE, localEntries } from '../local/db.js';
import {
  ARCHIVED_STORES,
  archiveLines,
  buildArchive,
  localRestoreSink,
  restoreArchiveInto,
} from './archive-builder.js';
import type { ArchiveChunk } from './drive/archive.js';

export interface SelfTestReport {
  before: Record<string, number>;
  after: Record<string, number>;
  archive: {
    plaintextBytes: number;
    sealedBytes: number;
    chunks: number;
    records: number;
    peakBufferBytes: number;
    buildMillis: number;
  };
  restoreMillis: number;
  restoredRecords: number;
  /** JS heap growth across the whole run, when the browser exposes it. */
  heapGrowthBytes?: number;
  sampleReadable: boolean;
  countsUnchanged: boolean;
}

async function counts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const store of ARCHIVED_STORES) {
    try {
      out[store] = (await localEntries<unknown>(store)).length;
    } catch {
      out[store] = -1;
    }
  }
  return out;
}

function heapUsed(): number | undefined {
  const perf = performance as unknown as { memory?: { usedJSHeapSize?: number } };
  return perf.memory?.usedJSHeapSize;
}

/**
 * Build from the real database, restore back into it, and report.
 *
 * `recoveryPublicKey` is any P-256 SPKI — the caller can pass a throwaway, since
 * this is checking the pipeline rather than the account's real recovery key.
 */
export async function archiveSelfTest(
  recoveryPublicKey: string,
  recoveryPrivateKey: CryptoKey,
  chunkSize = 1024 * 1024,
): Promise<SelfTestReport> {
  const heapBefore = heapUsed();
  const before = await counts();

  const chunks: ArchiveChunk[] = [];
  const { manifest, stats } = await buildArchive(
    recoveryPublicKey,
    1,
    async (chunk) => {
      chunks.push(chunk);
    },
    () => archiveLines(),
    chunkSize,
  );

  const restoreStarted = Date.now();
  const restored = await restoreArchiveInto(
    chunks.map((chunk) => chunk.bytes),
    manifest,
    recoveryPrivateKey,
    localRestoreSink,
  );
  const restoreMillis = Date.now() - restoreStarted;

  const after = await counts();

  /*
   * A record that was written back has to still open with the device key. If
   * re-sealing produced something this device cannot read, every count would
   * still match and the database would be quietly ruined.
   */
  let sampleReadable = true;
  const entries = await localEntries<unknown>(STORE.conversations).catch(() => []);
  if (entries.length > 0) {
    sampleReadable = (await openRecord<unknown>(entries[0]![1]).catch(() => undefined)) !== undefined;
  }

  const heapAfter = heapUsed();

  return {
    before,
    after,
    archive: {
      plaintextBytes: stats.plaintextBytes,
      sealedBytes: stats.sealedBytes,
      chunks: stats.chunks,
      records: stats.records,
      peakBufferBytes: stats.peakBufferBytes,
      buildMillis: stats.millis,
    },
    restoreMillis,
    restoredRecords: restored.records,
    heapGrowthBytes: heapBefore !== undefined && heapAfter !== undefined ? heapAfter - heapBefore : undefined,
    sampleReadable,
    countsUnchanged: ARCHIVED_STORES.every((store) => before[store] === after[store]),
  };
}
