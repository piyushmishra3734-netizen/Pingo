/**
 * Building and uploading at the same time.
 *
 * The claim under test is narrow and easy to lose by accident: at no point does
 * anything hold the whole archive. A version that buffered would pass every
 * other suite in this repository and fail only on a phone with a long history,
 * which is the worst place to find out.
 *
 * Run with `pnpm verify:drive-streaming`.
 */
import { buildArchive } from '../src/lib/backup/archive-builder.js';
import { GoogleDriveBackupTarget } from '../src/lib/backup/drive/drive-target.js';
import type { ArchiveChunk } from '../src/lib/backup/drive/archive.js';
import { FakeAuth, FakeDrive } from './fake-drive.js';

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

const CHUNK = 256 * 1024;

/** A database big enough to need many chunks. */
function source(messages: number) {
  return async function* () {
    yield encoder.encode(`${JSON.stringify({ kind: 'header', version: 1 })}\n`);
    for (let i = 0; i < messages; i += 1) {
      yield encoder.encode(
        `${JSON.stringify({
          kind: 'record',
          store: 'message-rows',
          key: `conv|${String(i).padStart(15, '0')}|m${i}`,
          value: { id: `m${i}`, body: `Message ${i}. ${'y'.repeat(120)}`, created_at: i },
        })}\n`,
      );
    }
    yield encoder.encode(`${JSON.stringify({ kind: 'end', records: messages, skipped: 0 })}\n`);
  };
}

/** The builder, bound to a source, in the shape the target expects. */
const builderFor = (messages: number, watch?: (chunk: ArchiveChunk) => void) =>
  async (
    publicKey: string,
    generation: number,
    onChunk: (chunk: ArchiveChunk) => Promise<void>,
  ) => {
    const { manifest, stats } = await buildArchive(
      publicKey,
      generation,
      async (chunk) => {
        watch?.(chunk);
        await onChunk(chunk);
      },
      source(messages),
      CHUNK,
    );
    return { manifest, stats };
  };

console.log('— streaming backup —');

const drive = new FakeDrive();
const target = new GoogleDriveBackupTarget(new FakeAuth(), drive.http);

/*
 * Uploads observed as they happen. If the implementation buffered, every file
 * would appear at the end rather than one at a time.
 */
const uploadedWhenSealed: number[] = [];
const result = await target.backupArchiveStreaming(
  recoveryPublic,
  builderFor(20_000, () => uploadedWhenSealed.push(drive.files.size)),
);

check(result.generation === 1, 'first streaming backup is generation 1');
check(result.records === 20_000, `${result.records} records carried`);
check(result.skipped === 0, 'nothing skipped');
check(uploadedWhenSealed.length > 5, `sealed in ${uploadedWhenSealed.length} chunks`);

/*
 * The number of files in Drive grew while chunks were still being sealed. A
 * buffering implementation would show zero for every observation.
 */
check(
  uploadedWhenSealed.some((count) => count > 0) && uploadedWhenSealed[0] === 0,
  'chunks reach Drive while later ones are still being built',
);
check(
  uploadedWhenSealed[uploadedWhenSealed.length - 1]! >= uploadedWhenSealed.length - 2,
  'each chunk is uploaded before the next is sealed, not batched at the end',
);

console.log('\n— atomic commit —');

check((await target.head())?.generation === 1, 'HEAD points at the finished generation');
check(drive.names().includes('pingo.manifest.g1.json'), 'the manifest is present');
const restored = await target.restoreArchive(recovery.privateKey);
check(restored.generation === 1, 'the streamed archive restores');
const text = new TextDecoder().decode(restored.plaintext);
check(text.includes('"m0"') && text.includes('"m19999"'), 'first and last records are both present');

console.log('\n— interrupted during streaming —');

const flaky = new FakeDrive();
const flakyTarget = new GoogleDriveBackupTarget(new FakeAuth(), flaky.http);
let sealedBeforeFailure = 0;

let died = false;
try {
  await flakyTarget.backupArchiveStreaming(
    recoveryPublic,
    builderFor(20_000, () => {
      sealedBeforeFailure += 1;
      // Die partway, after several chunks are already in Drive.
      if (sealedBeforeFailure === 4) flaky.failUploads = true;
    }),
  );
} catch {
  died = true;
}

check(died, 'the backup fails rather than reporting success');
check((await flakyTarget.head()) === undefined, 'HEAD never moved, so no half-written generation is live');
const partial = flaky.names().filter((n) => n.startsWith('pingo.g1.')).length;
check(partial > 0, `${partial} chunks were delivered before the failure`);
check(!flaky.names().includes('pingo.manifest.g1.json'), 'and no manifest was written');

console.log('\n— resuming picks up where it stopped —');

flaky.failUploads = false;
const resumedRun = await flakyTarget.backupArchiveStreaming(recoveryPublic, builderFor(20_000));

check(resumedRun.generation === 1, 'the same uncommitted generation number is reused');
/*
 * Discarded, not reused. Chunks from the dead attempt were sealed under a
 * different ephemeral key, so the manifest this run writes could never open
 * them — the first version of this test reported a successful resume and then
 * restored to "Backup part 0 is damaged".
 */
check(
  resumedRun.discarded === partial,
  `${resumedRun.discarded} chunks from the dead attempt were discarded, not reused`,
);
check((await flakyTarget.head())?.generation === 1, 'and this time it commits');

const afterResume = await flakyTarget.restoreArchive(recovery.privateKey);
check(
  new TextDecoder().decode(afterResume.plaintext).includes('"m19999"'),
  'the resumed archive is complete and restores',
);

console.log('\n— a committed generation is not reused —');

const next = await flakyTarget.backupArchiveStreaming(recoveryPublic, builderFor(1_000));
check(next.generation === 2, 'the next backup takes a new generation');
check(next.discarded === 0, 'and discards nothing, because the previous one committed');
check(
  flaky.names().filter((n) => n.startsWith('pingo.g1.')).length === 0,
  'the superseded generation is cleaned up',
);

console.log('\n— memory stays bounded —');

const big = new FakeDrive();
const bigTarget = new GoogleDriveBackupTarget(new FakeAuth(), big.http);

let liveBytes = 0;
let peakLive = 0;
const measured = await bigTarget.backupArchiveStreaming(
  recoveryPublic,
  builderFor(120_000, (chunk) => {
    // What the caller is holding at the instant a chunk is handed over.
    liveBytes = chunk.bytes.length;
    peakLive = Math.max(peakLive, liveBytes);
  }),
);

const totalSealed = [...big.files.values()]
  .filter((f) => /^pingo\.g\d+\.\d+$/.test(f.name))
  .reduce((sum, f) => sum + f.bytes.length, 0);

console.log(`\narchive on Drive : ${(totalSealed / 1024 / 1024).toFixed(2)} MB`);
console.log(`chunks           : ${measured.records ? big.names().filter((n) => /^pingo\.g\d+\.\d+$/.test(n)).length : 0}`);
console.log(`largest chunk    : ${(peakLive / 1024).toFixed(0)} KB (chunk size ${CHUNK / 1024} KB)`);
console.log(`records          : ${measured.records}`);

check(totalSealed > 8 * 1024 * 1024, `archive is ${(totalSealed / 1024 / 1024).toFixed(1)} MB, comfortably multi-chunk`);
check(
  peakLive <= CHUNK + 64,
  'no single handoff exceeds one chunk, so nothing accumulates the archive',
);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
