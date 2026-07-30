/**
 * Drive as a backup target: generations, the commit point, and restore.
 *
 * The question here is not whether bytes survive a round trip — the archive and
 * client suites answer that — but whether a backup that dies halfway leaves the
 * previous one intact. A backup system that can destroy a good backup while
 * failing to write a new one is worse than none, because the user believes they
 * are covered right up until they are not.
 *
 * Run with `pnpm verify:drive-target`.
 */
import { GoogleDriveBackupTarget } from '../src/lib/backup/drive/drive-target.js';
import { ArchiveError } from '../src/lib/backup/drive/archive.js';
import { FakeAuth, FakeDrive } from './fake-drive.js';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
};

const recovery = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
  'deriveKey',
  'deriveBits',
]);
const recoveryPublic = Buffer.from(
  new Uint8Array(await crypto.subtle.exportKey('spki', recovery.publicKey)),
).toString('base64');

const chats = (marker: number) => {
  const bytes = new Uint8Array(6 * 1024 * 1024);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = (i + marker) & 0xff;
  return bytes;
};

console.log('— the recovery package on Drive —');

const drive = new FakeDrive();
const target = new GoogleDriveBackupTarget(new FakeAuth(), drive.http);

check(!(await target.status()).present, 'nothing there to begin with');

await target.put({
  package: { version: 1, kdf: 'pbkdf2-sha256-600000', salt: 's', iv: 'i', package: 'sealed' },
  publicKey: recoveryPublic,
});

const stored = await target.get();
check(stored?.package.package === 'sealed', 'the package round-trips through Drive');
check((await target.status()).present, 'status reports it present');
check((await target.status()).version === 1, 'and reports the version');

/*
 * Drive holds a blob it cannot read. The bytes on the wire are the sealed
 * package, never anything Google could open.
 */
const raw = [...drive.files.values()].find((f) => f.name === 'pingo.recovery.json')!;
check(
  !new TextDecoder().decode(raw.bytes).includes('BEGIN'),
  'Drive receives an opaque blob, not key material in the clear',
);

console.log('\n— first archive —');

const first = await target.backupArchive(chats(1), recoveryPublic);
check(first.generation === 1, 'first archive is generation 1');
check((await target.head())?.generation === 1, 'HEAD points at it');
check(drive.names().includes('pingo.manifest.g1.json'), 'the manifest is written');
check(drive.names().filter((n) => /^pingo\.g1\.\d+$/.test(n)).length === 2, 'chunks are written');

const restored = await target.restoreArchive(recovery.privateKey);
check(restored.generation === 1, 'restore reports the generation it read');
check(
  Buffer.compare(Buffer.from(restored.plaintext), Buffer.from(chats(1))) === 0,
  'restore is byte-identical to what was backed up',
);

console.log('\n— second archive replaces, and cleans up —');

const second = await target.backupArchive(chats(2), recoveryPublic);
check(second.generation === 2, 'generation increments');
check((await target.head())?.generation === 2, 'HEAD moves to the new generation');
check(
  drive.names().filter((n) => n.startsWith('pingo.g1.')).length === 0,
  'generation 1 chunks are removed',
);
check(!drive.names().includes('pingo.manifest.g1.json'), 'the old manifest is removed');
check(drive.names().includes('pingo.recovery.json'), 'the recovery package is left alone');

const restoredSecond = await target.restoreArchive(recovery.privateKey);
check(
  Buffer.compare(Buffer.from(restoredSecond.plaintext), Buffer.from(chats(2))) === 0,
  'restore returns the newer archive',
);

console.log('\n— a backup that dies before the commit changes nothing —');

const beforeHead = await target.head();
const beforeNames = drive.names();

drive.failUploads = true;
let died = false;
try {
  await target.backupArchive(chats(3), recoveryPublic);
} catch {
  died = true;
}
drive.failUploads = false;

check(died, 'the failing backup reports failure');
check((await target.head())?.generation === beforeHead?.generation, 'HEAD did not move');

const stillRestores = await target.restoreArchive(recovery.privateKey);
check(
  Buffer.compare(Buffer.from(stillRestores.plaintext), Buffer.from(chats(2))) === 0,
  'the previous backup still restores intact',
);
check(
  beforeNames.every((name) => drive.names().includes(name)),
  'nothing that existed was deleted by the failed attempt',
);

console.log('\n— replay of an older generation is refused —');

/*
 * A restoring device that has already accepted generation 2 must not be walked
 * backwards onto an older archive by a Drive that serves a stale HEAD.
 */
let rolledBack = false;
try {
  await target.restoreArchive(recovery.privateKey, 3);
} catch (cause) {
  rolledBack = cause instanceof ArchiveError && cause.code === 'rolled-back';
}
check(rolledBack, 'an archive older than one already restored is refused');

console.log('\n— a damaged chunk in Drive is caught —');

const damagedDrive = new FakeDrive();
const damagedTarget = new GoogleDriveBackupTarget(new FakeAuth(), damagedDrive.http);
await damagedTarget.backupArchive(chats(4), recoveryPublic);

const victim = [...damagedDrive.files.values()].find((f) => /^pingo\.g1\.0$/.test(f.name))!;
victim.bytes[5000] ^= 0xff;

let caught = false;
try {
  await damagedTarget.restoreArchive(recovery.privateKey);
} catch (cause) {
  caught = cause instanceof ArchiveError && cause.code === 'chunk-corrupt';
}
check(caught, 'a chunk corrupted at rest is caught before anything is restored');

console.log('\n— a missing chunk is caught —');

const holedDrive = new FakeDrive();
const holedTarget = new GoogleDriveBackupTarget(new FakeAuth(), holedDrive.http);
await holedTarget.backupArchive(chats(5), recoveryPublic);
const dropped = [...holedDrive.files.values()].find((f) => /^pingo\.g1\.1$/.test(f.name))!;
holedDrive.files.delete(dropped.id);

let holed = false;
try {
  await holedTarget.restoreArchive(recovery.privateKey);
} catch (cause) {
  holed = cause instanceof ArchiveError && cause.code === 'chunk-count';
}
check(holed, 'a chunk deleted from Drive is caught');

console.log('\n— disconnect —');

const dropDrive = new FakeDrive();
const dropAuth = new FakeAuth();
const dropTarget = new GoogleDriveBackupTarget(dropAuth, dropDrive.http);
await dropTarget.backupArchive(chats(6), recoveryPublic);
await dropTarget.put({
  package: { version: 1, kdf: 'k', salt: 's', iv: 'i', package: 'sealed' },
  publicKey: recoveryPublic,
});

check(dropDrive.files.size > 0, 'Drive holds backup files');
await dropTarget.remove();
check(dropDrive.files.size === 0, 'remove clears every PINGO file from appDataFolder');

await dropTarget.disconnect();
let refused = false;
try {
  await dropTarget.backupArchive(chats(7), recoveryPublic);
} catch {
  refused = true;
}
check(refused, 'after disconnecting, Drive cannot be written to');

console.log('\n— restore with nothing there —');

const emptyTarget = new GoogleDriveBackupTarget(new FakeAuth(), new FakeDrive().http);
let nothing = false;
try {
  await emptyTarget.restoreArchive(recovery.privateKey);
} catch {
  nothing = true;
}
check(nothing, 'restoring with no backup reports it rather than returning empty');

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
