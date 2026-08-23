/**
 * The backup anchor: what a Drive folder's owner still cannot do.
 *
 * `docs/backup-security-review.md` left two gaps open and proposed closing them
 * with client-side cryptography. That proposal does not work, and the reason is
 * worth stating where it will be read: in Simple mode the archive's private key
 * lives in the Drive folder, in the clear, next to the archive it opens. An
 * attacker with write access to that folder has the key. They can seal a
 * complete archive of their own that decrypts perfectly, and they can compute
 * any MAC derived from that key. Signing HEAD with it would have shipped a
 * defence made entirely of things the attacker already holds.
 *
 * So the anchor lives on the server instead, and this suite plays the attacker.
 * Every scenario below is one where the old code restored something wrong and
 * said nothing:
 *
 *   * an older, genuine generation put back in place
 *   * a forged archive substituted for the current one
 *   * a forged archive committed one generation past the real one
 *
 * The fixture is deliberately a *working* forgery - sealed to the real public
 * key, opening without complaint. If the anchor check were deleted these tests
 * would not error; they would restore the attacker's messages. The control at
 * the end proves exactly that by running the same forgery with no anchor.
 *
 * Run with `pnpm verify:backup-anchor`.
 */
import {
  AnchorError,
  checkAnchor,
  nextGeneration,
  type AnchorStore,
  type BackupAnchor,
} from '../src/lib/backup/anchor.js';
import { buildArchive } from '../src/lib/backup/archive-builder.js';
import { sealArchive, type ArchiveChunk, type ArchiveManifest } from '../src/lib/backup/drive/archive.js';
import { GoogleDriveBackupTarget } from '../src/lib/backup/drive/drive-target.js';
import { computeManifestHash } from '../src/lib/backup/receipt.js';
import { FakeAuth, FakeDrive } from './fake-drive.js';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
};

/** Run something that must be refused, and report which refusal came back. */
async function refused(what: string, code: string, run: () => Promise<unknown>) {
  try {
    await run();
    check(false, `${what} - it was ALLOWED`);
  } catch (cause) {
    const actual = cause instanceof AnchorError ? cause.code : String((cause as Error).name);
    check(actual === code, `${what} (${actual})`);
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const recovery = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
  'deriveKey',
  'deriveBits',
]);
const recoveryPublic = Buffer.from(
  new Uint8Array(await crypto.subtle.exportKey('spki', recovery.publicKey)),
).toString('base64');

// ---------------------------------------------------------------------------
// 1. The rules, on their own
// ---------------------------------------------------------------------------

console.log('\n--- picking the next generation ---');

check(nextGeneration(undefined, undefined) === 1, 'a first backup is generation 1');
check(nextGeneration(4, { generation: 4, manifestHash: 'h' }) === 5, 'normally one past both');
check(
  nextGeneration(4, { generation: 5, manifestHash: 'h' }) === 6,
  'a run that anchored then died leaves the anchor ahead, and the next backup steps past it',
);
check(
  nextGeneration(9, undefined) === 10,
  'an account with no anchor yet still continues its Drive lineage',
);

console.log('\n--- what a restore accepts ---');

const manifestAt = (generation: number) => ({ generation }) as ArchiveManifest;

const allowed = (manifest: ArchiveManifest, anchor: BackupAnchor | undefined, hash: string) => {
  try {
    checkAnchor(manifest, anchor, hash);
    return true;
  } catch {
    return false;
  }
};

check(
  allowed(manifestAt(3), undefined, 'anything'),
  'a backup made before anchors existed is allowed through',
);
check(
  allowed(manifestAt(3), { generation: 3, manifestHash: 'abc' }, 'abc'),
  'the anchored generation, with the anchored hash, opens',
);

const cases: Array<[string, ArchiveManifest, BackupAnchor, string, string]> = [
  ['an older generation is a rollback', manifestAt(2), { generation: 3, manifestHash: 'abc' }, 'abc', 'rolled-back'],
  ['a newer one was never recorded', manifestAt(4), { generation: 3, manifestHash: 'abc' }, 'abc', 'unanchored'],
  [
    'a different archive at the anchored generation',
    manifestAt(3),
    { generation: 3, manifestHash: 'abc' },
    'zzz',
    'substituted',
  ],
];

for (const [what, manifest, anchor, hash, code] of cases) {
  try {
    checkAnchor(manifest, anchor, hash);
    check(false, `${what} - it was ALLOWED`);
  } catch (cause) {
    const actual = cause instanceof AnchorError ? cause.code : String((cause as Error).name);
    check(actual === code, `${what} (${actual})`);
  }
}

// ---------------------------------------------------------------------------
// 2. Against the real target, with an attacker in the folder
// ---------------------------------------------------------------------------

/** The server's rule, in memory: monotonic, and the only writer of record. */
function memoryAnchor() {
  const store = {
    row: undefined as BackupAnchor | undefined,
    async read() {
      return store.row;
    },
    async write(anchor: BackupAnchor) {
      if (store.row && anchor.generation <= store.row.generation) {
        throw new Error(`generation ${anchor.generation} is not newer than ${store.row.generation}`);
      }
      store.row = anchor;
    },
    async clear() {
      store.row = undefined;
    },
  };
  return store;
}

const source = (messages: number, tag: string) =>
  async function* () {
    yield encoder.encode(`${JSON.stringify({ kind: 'header', version: 1 })}\n`);
    for (let i = 0; i < messages; i += 1) {
      yield encoder.encode(
        `${JSON.stringify({
          kind: 'record',
          store: 'message-rows',
          key: `conv|${String(i).padStart(15, '0')}|m${i}`,
          value: { id: `m${i}`, body: `${tag} ${i}`, created_at: i },
        })}\n`,
      );
    }
    yield encoder.encode(`${JSON.stringify({ kind: 'end', records: messages, skipped: 0 })}\n`);
  };

const builderFor =
  (messages: number, tag: string) =>
  async (publicKey: string, generation: number, onChunk: (chunk: ArchiveChunk) => Promise<void>) =>
    buildArchive(publicKey, generation, onChunk, source(messages, tag));

const snapshot = (drive: FakeDrive) => new Map([...drive.files].map(([id, f]) => [id, { ...f }]));

/** Write straight into the folder, the way somebody holding the folder would. */
function attackerPut(drive: FakeDrive, name: string, bytes: Uint8Array) {
  for (const [id, file] of drive.files) if (file.name === name) drive.files.delete(id);
  const id = `evil-${drive.nextId++}`;
  drive.files.set(id, { id, name, bytes });
}

/**
 * A complete, valid archive of the attacker's choosing.
 *
 * Sealed to the real public key, because in Simple mode that key is in the
 * folder they are standing in. Nothing about this archive is malformed - that
 * is the whole point.
 */
async function forge(drive: FakeDrive, generation: number) {
  const evil = encoder.encode(
    `${[
      JSON.stringify({ kind: 'header', version: 1 }),
      JSON.stringify({
        kind: 'record',
        store: 'message-rows',
        key: 'conv|000000000000001|evil',
        value: { id: 'evil', body: 'planted', created_at: 1 },
      }),
      JSON.stringify({ kind: 'end', records: 1, skipped: 0 }),
    ].join('\n')}\n`,
  );
  const { manifest, chunks } = await sealArchive(evil, recoveryPublic, generation);
  for (const chunk of chunks) attackerPut(drive, `pingo.g${generation}.${chunk.index}`, chunk.bytes);
  attackerPut(drive, `pingo.manifest.g${generation}.json`, encoder.encode(JSON.stringify(manifest)));
  attackerPut(drive, 'pingo.head.json', encoder.encode(JSON.stringify({ generation, updatedAt: Date.now() })));
}

console.log('\n--- an ordinary account, backing up twice ---');

const drive = new FakeDrive();
const target = new GoogleDriveBackupTarget(new FakeAuth(), drive.http);
const anchor = memoryAnchor();

const first = await target.backupArchiveStreaming(
  recoveryPublic,
  builderFor(40, 'one'),
  undefined,
  undefined,
  anchor,
);
check(first.generation === 1, 'the first backup is generation 1');
check(anchor.row?.generation === 1, 'and the server recorded it');

/* Kept, because the second backup deletes them and the rollback needs them. */
const generationOne = snapshot(drive);

const second = await target.backupArchiveStreaming(
  recoveryPublic,
  builderFor(60, 'two'),
  undefined,
  undefined,
  anchor,
);
check(second.generation === 2, 'the second is generation 2');
check(anchor.row?.generation === 2, 'the anchor moved with it');

const honest = await target.restoreArchive(recovery.privateKey, 0, undefined, anchor);
check(honest.generation === 2, 'the honest restore reads generation 2');
check(decoder.decode(honest.plaintext).includes('two 0'), 'and gets the archive that was written');

console.log('\n--- now somebody else has the folder ---');

await refused('a forged archive substituted for the current one', 'substituted', async () => {
  const saved = snapshot(drive);
  try {
    await forge(drive, 2);
    return await target.restoreArchive(recovery.privateKey, 0, undefined, anchor);
  } finally {
    drive.files = saved;
  }
});

await refused('a forged archive committed one generation past the real one', 'unanchored', async () => {
  const saved = snapshot(drive);
  try {
    await forge(drive, 3);
    return await target.restoreArchive(recovery.privateKey, 0, undefined, anchor);
  } finally {
    drive.files = saved;
  }
});

await refused('last month, genuine and correctly sealed, put back in place', 'rolled-back', async () => {
  const saved = snapshot(drive);
  try {
    drive.files = generationOne;
    return await target.restoreArchive(recovery.privateKey, 0, undefined, anchor);
  } finally {
    drive.files = saved;
  }
});

/*
 * The control.
 *
 * The same forgery, the same code, no anchor supplied - which is what every
 * backup did before this existed. It has to succeed, or the three refusals
 * above are proving something about the fixture rather than about the anchor.
 */
console.log('\n--- the control: the same forgery, unanchored ---');

const openDrive = new FakeDrive();
const openTarget = new GoogleDriveBackupTarget(new FakeAuth(), openDrive.http);
await openTarget.backupArchiveStreaming(recoveryPublic, builderFor(40, 'one'));
await forge(openDrive, 2);
const swallowed = await openTarget.restoreArchive(recovery.privateKey);
check(
  decoder.decode(swallowed.plaintext).includes('planted'),
  'without an anchor the forgery restores cleanly - this is the hole being closed',
);

console.log('\n--- the failures that are ours, not an attacker\'s ---');

/*
 * Two devices backing up at once, both having read the anchor before either
 * wrote. The second one's generation is not newer, the server refuses it, and
 * the attempt dies before the committed pointer moves.
 */
const raceDrive = new FakeDrive();
const raceTarget = new GoogleDriveBackupTarget(new FakeAuth(), raceDrive.http);
const raceAnchor = memoryAnchor();
await raceTarget.backupArchiveStreaming(recoveryPublic, builderFor(20, 'a'), undefined, undefined, raceAnchor);

let raced = false;
try {
  /*
   * The interleaving, made deterministic: this device reads the anchor, picks
   * its generation, and the other device commits that same number in the
   * instant before this one's write lands.
   */
  let other = false;
  const contended: AnchorStore = {
    read: async () => raceAnchor.row,
    write: async (a) => {
      if (!other) {
        other = true;
        await raceAnchor.write({ generation: a.generation, manifestHash: 'the other device' });
      }
      await raceAnchor.write(a);
    },
    clear: raceAnchor.clear,
  };
  await raceTarget.backupArchiveStreaming(recoveryPublic, builderFor(20, 'b'), undefined, undefined, contended);
} catch {
  raced = true;
}
check(raced, 'a second device landing on a taken generation is refused');
check((await raceTarget.head())?.generation === 1, 'and the committed pointer never moved');

/*
 * The crash window: anchored, then dead before the commit. The next backup has
 * to step past the anchor rather than collide with it, or the account can never
 * back up again.
 */
const healDrive = new FakeDrive();
const healTarget = new GoogleDriveBackupTarget(new FakeAuth(), healDrive.http);
const healAnchor = memoryAnchor();
await healTarget.backupArchiveStreaming(recoveryPublic, builderFor(20, 'a'), undefined, undefined, healAnchor);
healAnchor.row = { generation: 2, manifestHash: 'written, never committed' };

const healed = await healTarget.backupArchiveStreaming(
  recoveryPublic,
  builderFor(20, 'c'),
  undefined,
  undefined,
  healAnchor,
);
check(healed.generation === 3, 'a backup after an uncommitted one lands at 3, not 2');
const afterHeal = await healTarget.restoreArchive(recovery.privateKey, 0, undefined, healAnchor);
check(afterHeal.generation === 3, 'and it restores');

const committedManifest = [...healDrive.files.values()].find((f) => f.name === 'pingo.manifest.g3.json');
check(
  healAnchor.row?.manifestHash ===
    (await computeManifestHash(JSON.parse(decoder.decode(committedManifest!.bytes)) as ArchiveManifest)),
  'the anchored hash is the hash of the manifest actually in Drive',
);

console.log(failures === 0 ? '\nAll good.\n' : `\n${failures} failed.\n`);
process.exit(failures === 0 ? 0 : 1);
