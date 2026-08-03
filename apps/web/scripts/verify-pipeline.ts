/**
 * The whole backup lifecycle, end to end, finishing on a wiped device.
 *
 * Every module below has its own suite proving it works alone. This is the one
 * that proves they work in the right order: that the proof genuinely blocks the
 * archive, that verification runs while rollback is still possible, that the
 * receipt records what actually happened, and that a device with nothing on it
 * can read the result back and check it against that receipt.
 *
 * Real modules throughout — real backfill, real proof, real archive builder,
 * real Drive target against the in-memory Drive, real verification, real sealed
 * receipt. The only stand-ins are the network and the database.
 *
 * Run with `pnpm verify:pipeline`.
 */
import { buildArchive } from '../src/lib/backup/archive-builder.js';
import {
  runBackfill,
  type BackfillRow,
  type BackfillSink,
  type BackfillSource,
  type CursorStore,
} from '../src/lib/backup/backfill.js';
import {
  proveCompleteness,
  type CursorReader,
  type LocalCounts,
  type ProofSource,
} from '../src/lib/backup/completeness.js';
import { runBackup, STAGE_LABELS, type BackupPorts, type BackupStage } from '../src/lib/backup/pipeline.js';
import {
  computeArchiveHash,
  computeManifestHash,
  openReceipt,
  verifyRestore,
  type BackupReceipt,
  type SealedReceipt,
} from '../src/lib/backup/receipt.js';
import { verifyBackup } from '../src/lib/backup/verification.js';
import { openArchiveHeader, type ArchiveChunk } from '../src/lib/backup/drive/archive.js';
import { GoogleDriveBackupTarget } from '../src/lib/backup/drive/drive-target.js';
import type { PreflightSummary } from '../src/lib/backup/preflight.js';
import { FakeAuth, FakeDrive } from './fake-drive.js';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const recovery = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
  'deriveKey',
  'deriveBits',
]);
const recoveryPublic = Buffer.from(
  new Uint8Array(await crypto.subtle.exportKey('spki', recovery.publicKey)),
).toString('base64');

/** Three conversations of real history, held by the "server". */
const HISTORY = new Map<string, BackfillRow[]>(
  [
    ['conv-a', 240],
    ['conv-b', 130],
    ['conv-c', 55],
  ].map(([id, n]) => [
    id as string,
    Array.from({ length: n as number }, (_, i) => ({
      id: `${id}-m${String((n as number) - i).padStart(5, '0')}`,
      created_at: new Date(1_700_000_000_000 + ((n as number) - i) * 1000).toISOString(),
    })),
  ]),
);
const TOTAL_MESSAGES = [...HISTORY.values()].reduce((sum, rows) => sum + rows.length, 0);

/** Everything a device holds, and everything the account looks like from outside. */
function account(options: { breakConversation?: string } = {}) {
  const rows = new Map<string, Map<string, BackfillRow>>();
  const cursors = new Map<string, unknown>();

  const older = (id: string, before: string | undefined) => {
    const all = HISTORY.get(id) ?? [];
    if (!before) return all;
    const i = all.findIndex((r) => r.id === before);
    return i < 0 ? all : all.slice(i + 1);
  };

  const backfillSource: BackfillSource = {
    async conversations() {
      return [...HISTORY.keys()];
    },
    async page(id, before, limit) {
      if (id === options.breakConversation) throw new Error('unreachable');
      return older(id, before).slice(0, limit);
    },
    async countOlderThan(id, before) {
      return older(id, before).length;
    },
  };

  const sink: BackfillSink = {
    async write(id, page) {
      const bucket = rows.get(id) ?? new Map<string, BackfillRow>();
      let written = 0;
      for (const r of page) {
        if (!bucket.has(r.id)) written += 1;
        bucket.set(r.id, r);
      }
      rows.set(id, bucket);
      return { written, unreadable: 0 };
    },
  };

  const cursorStore: CursorStore & CursorReader = {
    async read(id) {
      return cursors.get(id);
    },
    async write(id, cursor) {
      cursors.set(id, cursor);
    },
  };

  const proofSource: ProofSource = {
    async conversations() {
      return [...HISTORY.keys()];
    },
    async countMessages(id) {
      return HISTORY.get(id)?.length ?? 0;
    },
  };

  const localCounts: LocalCounts = {
    async conversations() {
      return [...rows.keys()];
    },
    async countMessages(id) {
      return rows.get(id)?.size ?? 0;
    },
  };

  return { rows, cursors, backfillSource, sink, cursorStore, proofSource, localCounts };
}

const PREFLIGHT: PreflightSummary = {
  conversations: HISTORY.size,
  messages: TOTAL_MESSAGES,
  photos: 4,
  videos: 1,
  documents: 2,
  voiceNotes: 3,
  archive: { bytes: 200_000, low: 160_000, high: 240_000, sampledRows: 100, assumed: false },
  mediaBytes: 5_000,
  toDownload: TOTAL_MESSAGES,
  empty: false,
  partial: false,
  unavailable: [],
  measuredAt: Date.now(),
};

/** The archive source: the header the proof produced, then every stored row. */
function archiveSource(
  rows: Map<string, Map<string, BackfillRow>>,
  completeness: { conversations: number; messages: number; provenAt: number },
) {
  return async function* () {
    yield encoder.encode(
      `${JSON.stringify({ kind: 'header', version: 1, createdAt: Date.now(), stores: ['message-rows'], completeness })}\n`,
    );
    let records = 0;
    for (const [conversationId, bucket] of rows) {
      for (const [id, row] of bucket) {
        records += 1;
        yield encoder.encode(
          `${JSON.stringify({
            kind: 'record',
            store: 'message-rows',
            key: `${conversationId}|${id}`,
            value: row,
          })}\n`,
        );
      }
    }
    yield encoder.encode(`${JSON.stringify({ kind: 'end', records, skipped: 0 })}\n`);
  };
}

/** Wire the real modules into the pipeline's ports, against one Drive. */
function ports(
  world: ReturnType<typeof account>,
  target: GoogleDriveBackupTarget,
  receipts: SealedReceipt[],
  options: { sabotage?: (drive: FakeDrive) => Promise<void>; drive?: FakeDrive } = {},
): BackupPorts {
  let seq = 0;
  let verification: Awaited<ReturnType<typeof verifyBackup>> | undefined;
  return {
    async preflight() {
      return PREFLIGHT;
    },
    async backfill(signal) {
      return runBackfill(world.backfillSource, world.sink, world.cursorStore, {
        pageSize: 50,
        signal,
        delay: async () => {},
      });
    },
    async prove() {
      return proveCompleteness(world.proofSource, world.localCounts, world.cursorStore);
    },
    async archive(completeness, onProgress) {
      onProgress({ stage: 'uploading', detail: 'Uploading to Google Drive' });

      let captured: Awaited<ReturnType<typeof buildArchive>>['manifest'] | undefined;
      let archiveBytes = 0;

      const result = await target.backupArchiveStreaming(
        recoveryPublic,
        async (publicKey, generation, onChunk) => {
          const built = await buildArchive(
            publicKey,
            generation,
            async (chunk: ArchiveChunk) => {
              archiveBytes += chunk.bytes.length;
              await onChunk(chunk);
            },
            archiveSource(world.rows, completeness),
            64 * 1024,
          );
          captured = built.manifest;
          return built;
        },
        undefined,
        async (generation) => {
          // Sabotage lands after the upload and after HEAD, which is exactly
          // where a real dropped object or a rotted byte would be found.
          if (options.sabotage && options.drive) await options.sabotage(options.drive);

          onProgress({ stage: 'verifying', detail: 'Checking the backup' });
          verification = await verifyBackup(
            target.verificationStore(),
            { generation, completeness },
            {
              readHeader: async (g) => {
                const store = target.verificationStore();
                const raw = await store.readManifest(g);
                if (!raw) return undefined;
                const manifest = JSON.parse(raw);
                const chunk = await store.readChunk(g, 0);
                if (!chunk) return undefined;
                const header = await openArchiveHeader(manifest, chunk, recovery.privateKey);
                return header as { completeness?: typeof completeness } | undefined;
              },
            },
          );
          return verification.status === 'verified';
        },
      );

      return {
        generation: result.generation,
        manifest: captured!,
        archiveBytes,
        verification: verification!,
      };
    },
    async previousReceipt() {
      const last = receipts[receipts.length - 1];
      if (!last) return undefined;
      return { sealed: last, receipt: await openReceipt(last, recovery.privateKey) };
    },
    async storeReceipt(sealed) {
      receipts.push(sealed);
    },
    recoveryPublicKey: recoveryPublic,
    mode: 'private',
    keyVersion: 1,
    newBackupId: () => `bk_${(seq += 1)}`,
  };
}


/** Restore on a device that holds nothing, and count what arrives. */
async function restoreOnWipedDevice(target: GoogleDriveBackupTarget) {
  const { plaintext, generation } = await target.restoreArchive(recovery.privateKey, 0);
  const lines = decoder.decode(plaintext).split('\n').filter(Boolean);

  const conversations = new Set<string>();
  let messages = 0;
  let header: Record<string, unknown> | undefined;

  for (const line of lines) {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    if (parsed.kind === 'header') header = parsed;
    if (parsed.kind === 'record') {
      messages += 1;
      conversations.add(String(parsed.key).split('|')[0]!);
    }
  }
  return { generation, conversations: conversations.size, messages, header };
}

console.log('— the whole lifecycle, in order —');

const drive = new FakeDrive();
const target = new GoogleDriveBackupTarget(new FakeAuth(), drive.http);
const world = account();
const receipts: SealedReceipt[] = [];
const stages: BackupStage[] = [];

const run = await runBackup(ports(world, target, receipts), {
  onProgress: (p) => {
    if (stages[stages.length - 1] !== p.stage) stages.push(p.stage);
  },
});

check(run.outcome === 'complete', `the backup completes (${run.outcome})`);
check(run.headline === 'Backup complete and fully verified.', `and says so: "${run.headline}"`);
check(run.proof?.status === 'proven', 'the account was proven complete');
check(run.verification?.status === 'verified', 'and the archive was read back');
check(run.receipt !== undefined, 'a receipt was written');
check(
  stages.join(' → ') === 'preparing → downloading → proving → encrypting → uploading → verifying → recording → done',
  `the stages ran in order: ${stages.join(' → ')}`,
);
check(
  stages.every((s) => STAGE_LABELS[s] !== undefined),
  'and every stage has a label, so none is invented at the call site',
);

console.log('\n— the receipt records what actually happened —');

{
  const receipt = run.receipt!;
  check(receipt.messages === TOTAL_MESSAGES, `every message is accounted for (${receipt.messages})`);
  check(receipt.conversations === 3, 'across three chats');
  check(receipt.completeness === 'proven', 'completeness is recorded as proven');
  check(receipt.verification === 'verified', 'and verification as verified');
  check(receipt.generation === 1, 'the generation is the one committed');
  check(receipt.mode === 'private' && receipt.keyVersion === 1, 'with the mode and key version');
  check(receipt.previousHash === undefined, 'the first receipt has no predecessor');
  check(receipts.length === 1, 'and exactly one receipt was stored');

  const opened = await openReceipt(receipts[0]!, recovery.privateKey);
  check(opened.backupId === receipt.backupId, 'the stored receipt opens to what was recorded');
  check(!JSON.stringify(receipts[0]).includes(String(TOTAL_MESSAGES)), 'and the count is not readable on Drive');
}

console.log('\n— a wiped device reads it back —');

{
  const restored = await restoreOnWipedDevice(target);

  check(restored.messages === TOTAL_MESSAGES, `every message restores (${restored.messages} of ${TOTAL_MESSAGES})`);
  check(restored.conversations === 3, 'all three conversations restore');
  check(restored.generation === 1, 'from the committed generation');

  const carried = restored.header?.completeness as { messages: number } | undefined;
  check(carried?.messages === TOTAL_MESSAGES, 'the completeness block travelled inside the encryption');

  const store = target.verificationStore();
  const manifest = JSON.parse((await store.readManifest(1))!);
  const verified = verifyRestore(run.receipt, {
    conversations: restored.conversations,
    messages: restored.messages,
    manifestHash: await computeManifestHash(manifest),
    archiveHash: await computeArchiveHash(manifest.chunks),
  });

  check(verified.status === 'verified', 'the restore verifies against the receipt');
  check(verified.warnings.length === 0, 'with no warnings');
  check(
    /Restored 425 messages across 3 chats/.test(verified.headline),
    `and reports what came back: "${verified.headline}"`,
  );
}

console.log('\n— a short proof blocks the archive —');

{
  const badDrive = new FakeDrive();
  const badTarget = new GoogleDriveBackupTarget(new FakeAuth(), badDrive.http);
  const broken = account({ breakConversation: 'conv-b' });
  const blocked = await runBackup(ports(broken, badTarget, []));

  check(blocked.outcome === 'incomplete', 'the run stops as incomplete');
  check(blocked.proof?.status === 'short', 'because the proof came back short');
  check(/130 messages are still missing/.test(blocked.headline), `and says how many: "${blocked.headline}"`);
  check(blocked.receipt === undefined, 'no receipt is written');
  check(blocked.generation === undefined, 'no generation is committed');
  check((await badTarget.head()) === undefined, 'and Drive holds no backup at all');
  check(
    badDrive.names().filter((n) => n.startsWith('pingo.g')).length === 0,
    'nothing was uploaded',
  );
}

console.log('\n— a failed verification keeps the previous backup —');

{
  const twoDrive = new FakeDrive();
  const twoTarget = new GoogleDriveBackupTarget(new FakeAuth(), twoDrive.http);
  const twoWorld = account();
  const twoReceipts: SealedReceipt[] = [];

  const first = await runBackup(ports(twoWorld, twoTarget, twoReceipts));
  check(first.outcome === 'complete' && first.generation === 1, 'the first backup succeeds');

  /*
   * The second run's archive is sabotaged after HEAD moves, which is the only
   * window where a bad generation is live and the old one still exists.
   */
  const second = await runBackup(
    ports(twoWorld, twoTarget, twoReceipts, {
      drive: twoDrive,
      sabotage: async (d) => {
        for (const [id, file] of d.files) {
          if (file.name.startsWith('pingo.g2.')) {
            d.files.delete(id);
            break;
          }
        }
      },
    }),
  );

  check(second.outcome === 'unverified', `the second backup is not accepted (${second.outcome})`);
  check(second.verification?.status === 'failed', 'verification failed');
  check(second.verification?.rolledBackTo === 1, 'and HEAD rolled back to generation 1');
  check((await twoTarget.head())?.generation === 1, 'the live pointer really is the old one');
  check(second.receipt === undefined, 'no receipt claims the failed backup');
  check(twoReceipts.length === 1, 'so the receipt chain still has only the good one');
  check(
    /previous backup from generation 1 is still in place/.test(second.headline),
    `and the user is told: "${second.headline}"`,
  );

  const stillGood = await restoreOnWipedDevice(twoTarget);
  check(stillGood.messages === TOTAL_MESSAGES, 'the old backup still restores in full');
  check(stillGood.generation === 1, 'from generation 1');
}

console.log('\n— the clean is what proves the ordering —');

{
  const orderDrive = new FakeDrive();
  const orderTarget = new GoogleDriveBackupTarget(new FakeAuth(), orderDrive.http);
  const orderWorld = account();
  const orderReceipts: SealedReceipt[] = [];

  await runBackup(ports(orderWorld, orderTarget, orderReceipts));
  const second = await runBackup(
    ports(orderWorld, orderTarget, orderReceipts, {
      drive: orderDrive,
      sabotage: async (d) => {
        for (const [id, file] of d.files) {
          if (file.name.startsWith('pingo.g2.')) {
            d.files.delete(id);
            break;
          }
        }
      },
    }),
  );

  check(second.outcome === 'unverified', 'the sabotaged run fails');
  check(
    orderDrive.names().includes('pingo.manifest.g1.json'),
    'generation 1 survived, so the clean did NOT run before verification',
  );
  check(
    orderDrive.names().some((n) => n.startsWith('pingo.g1.')),
    'including its chunks, which is what makes the rollback real',
  );
}

console.log('\n— a second good backup chains onto the first —');

{
  const chainDrive = new FakeDrive();
  const chainTarget = new GoogleDriveBackupTarget(new FakeAuth(), chainDrive.http);
  const chainWorld = account();
  const chainReceipts: SealedReceipt[] = [];

  const first = await runBackup(ports(chainWorld, chainTarget, chainReceipts));
  const second = await runBackup(ports(chainWorld, chainTarget, chainReceipts));

  check(second.outcome === 'complete', 'the second backup completes');
  check(second.generation === 2, 'as generation 2');
  check(second.receipt?.previousHash !== undefined, 'and its receipt links to the first');
  check(chainReceipts.length === 2, 'both receipts are kept');

  const opened: BackupReceipt[] = [];
  for (const sealed of chainReceipts) opened.push(await openReceipt(sealed, recovery.privateKey));
  check(opened[1]!.generation > opened[0]!.generation, 'generations only move forwards');

  check(
    !chainDrive.names().includes('pingo.manifest.g1.json'),
    'and now that generation 2 verified, generation 1 is cleaned up',
  );
  check(first.generation === 1, 'which is the generation the first run committed');
}

console.log('\n— a backfill that fetched nothing new still costs nothing —');

{
  const cheapDrive = new FakeDrive();
  const cheapTarget = new GoogleDriveBackupTarget(new FakeAuth(), cheapDrive.http);
  const cheapWorld = account();

  await runBackup(ports(cheapWorld, cheapTarget, []));
  const again = await runBackup(ports(cheapWorld, cheapTarget, []));

  check(again.outcome === 'complete', 'a repeat backup completes');
  check(again.backfill?.messagesFetched === 0, 'and fetches no messages at all');
  check(again.proof?.status === 'proven', 'while still proving completeness afresh');
}

console.log('\n— an empty account is not a backup —');

{
  const emptyDrive = new FakeDrive();
  const emptyTarget = new GoogleDriveBackupTarget(new FakeAuth(), emptyDrive.http);
  const emptyWorld = account();
  const emptyPorts = ports(emptyWorld, emptyTarget, []);

  const result = await runBackup({
    ...emptyPorts,
    async preflight() {
      return { ...PREFLIGHT, conversations: 0, messages: 0, toDownload: 0, empty: true };
    },
  });

  check(result.outcome === 'complete', 'a new account is not an error');
  check(result.headline === 'Nothing to back up yet.', `and is worded honestly: "${result.headline}"`);
  check(result.generation === undefined, 'no generation is committed');
  check((await emptyTarget.head()) === undefined, 'and nothing is uploaded');
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
