/**
 * Simple Backup's key, and the line it must never cross.
 *
 * This key is deliberately readable by Google — that is the whole trade of
 * Mode 1. What must stay true is that it is *only* the archive key: it must not
 * be the recovery key, and it must not open a live message envelope. Google
 * holding one is a stated trade; Google holding the other would be a breach of
 * §9 and of the promise on the enrolment screen.
 *
 * Run with `pnpm verify:archive-key`.
 */
import {
  ARCHIVE_KEY_FILE,
  ArchiveKeyError,
  ensureArchiveKey,
  hasArchiveKey,
  loadArchiveKey,
  type ArchiveKeyStore,
} from '../src/lib/backup/archive-key.js';
import { openArchive, sealArchive } from '../src/lib/backup/drive/archive.js';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** A Drive folder that keeps bytes and counts how often it was written. */
function fakeDrive() {
  const files = new Map<string, Uint8Array>();
  let uploads = 0;
  const store: ArchiveKeyStore = {
    async find(name) {
      return files.has(name) ? { id: name } : undefined;
    },
    async upload(name, bytes) {
      uploads += 1;
      files.set(name, bytes);
    },
    async download(id) {
      const bytes = files.get(id);
      if (!bytes) throw new Error('not found');
      return bytes;
    },
  };
  return { store, files, uploads: () => uploads };
}

console.log('— the key is made once and then reused —');

{
  const drive = fakeDrive();
  check(!(await hasArchiveKey(drive.store)), 'a fresh account has no archive key');

  const first = await ensureArchiveKey(drive.store);
  check(drive.files.has(ARCHIVE_KEY_FILE), `the key lands in Drive as ${ARCHIVE_KEY_FILE}`);
  check(await hasArchiveKey(drive.store), 'and is then reported present');

  const second = await ensureArchiveKey(drive.store);
  check(second.publicKey === first.publicKey, 'a second call returns the same key');
  check(drive.uploads() === 1, 'and writes nothing new');
}

{
  /*
   * Two devices must converge on one key. If the second generated its own, the
   * newest archive would be sealed to a key the first device does not hold and
   * whichever device restored second would find nothing it could open.
   */
  const drive = fakeDrive();
  const deviceA = await ensureArchiveKey(drive.store);
  const deviceB = await ensureArchiveKey(drive.store);
  check(deviceA.publicKey === deviceB.publicKey, 'a second device adopts the first key');
}

console.log('\n— it actually opens an archive —');

{
  const drive = fakeDrive();
  const key = await ensureArchiveKey(drive.store);

  const plaintext = encoder.encode(
    `${JSON.stringify({ kind: 'header', version: 1 })}\n${JSON.stringify({ kind: 'record', store: 'message-rows', key: 'c1|m1', value: { body: 'hello' } })}\n`,
  );
  const { manifest, chunks } = await sealArchive(plaintext, key.publicKey, 1);

  // The restoring device reads the key back out of Drive, as it would on a
  // phone that has only just signed in.
  const reloaded = await loadArchiveKey(drive.store);
  const opened = await openArchive(manifest, chunks, reloaded.privateKey, 0);

  check(decoder.decode(opened) === decoder.decode(plaintext), 'an archive sealed to it opens with no code');
  check(/hello/.test(decoder.decode(opened)), 'and the message content is really there');
}

{
  // Somebody else's archive key must not open this archive.
  const mine = fakeDrive();
  const theirs = fakeDrive();
  const key = await ensureArchiveKey(mine.store);
  const other = await ensureArchiveKey(theirs.store);

  const { manifest, chunks } = await sealArchive(encoder.encode('secret\n'), key.publicKey, 1);
  let opened = false;
  try {
    await openArchive(manifest, chunks, other.privateKey, 0);
    opened = true;
  } catch {
    /* expected */
  }
  check(!opened, 'a different account’s archive key does not open it');
}

console.log('\n— it is not the recovery key —');

{
  /*
   * The property that makes Simple mode defensible. Google holds this key, so
   * if it were also the recovery key Google could unwrap live message
   * envelopes — the thing the enrolment screen promises nobody can do.
   */
  const drive = fakeDrive();
  const archive = await ensureArchiveKey(drive.store);

  const recovery = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
    'deriveKey',
  ]);
  const recoveryPublic = Buffer.from(
    new Uint8Array(await crypto.subtle.exportKey('spki', recovery.publicKey)),
  ).toString('base64');

  check(archive.publicKey !== recoveryPublic, 'the two keys are different keys');

  // An archive sealed to the *recovery* key must not open with the archive key.
  const { manifest, chunks } = await sealArchive(encoder.encode('private\n'), recoveryPublic, 1);
  let crossed = false;
  try {
    await openArchive(manifest, chunks, archive.privateKey, 0);
    crossed = true;
  } catch {
    /* expected */
  }
  check(!crossed, 'the archive key cannot open something sealed to the recovery key');
}

console.log('\n— a broken key is refused, never replaced —');

{
  const drive = fakeDrive();
  await ensureArchiveKey(drive.store);
  const before = drive.files.get(ARCHIVE_KEY_FILE)!;

  drive.files.set(ARCHIVE_KEY_FILE, encoder.encode('{not json'));

  let code: string | undefined;
  try {
    await loadArchiveKey(drive.store);
  } catch (cause) {
    code = cause instanceof ArchiveKeyError ? cause.code : 'other';
  }
  check(code === 'unreadable', `a corrupt key is reported unreadable (${code})`);

  /*
   * The dangerous alternative: treat unreadable as missing and generate a new
   * one. That would overwrite the key every existing archive was sealed to, and
   * the backups would still verify while being permanently unopenable.
   */
  let threw = false;
  try {
    await ensureArchiveKey(drive.store);
  } catch {
    threw = true;
  }
  check(threw, 'and ensure refuses rather than generating over it');
  check(
    decoder.decode(drive.files.get(ARCHIVE_KEY_FILE)!) !== decoder.decode(before),
    'the corrupt bytes are left exactly as found, not silently repaired',
  );
}

{
  const drive = fakeDrive();
  await ensureArchiveKey(drive.store);
  drive.files.set(ARCHIVE_KEY_FILE, encoder.encode(JSON.stringify({ version: 2, privateKey: 'x', publicKey: 'y' })));
  let code: string | undefined;
  try {
    await loadArchiveKey(drive.store);
  } catch (cause) {
    code = cause instanceof ArchiveKeyError ? cause.code : 'other';
  }
  check(code === 'unsupported', 'a newer key version is refused rather than guessed at');
}

{
  const drive = fakeDrive();
  let code: string | undefined;
  try {
    await loadArchiveKey(drive.store);
  } catch (cause) {
    code = cause instanceof ArchiveKeyError ? cause.code : 'other';
  }
  check(code === 'missing', 'an account with no key reports missing, not unreadable');
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
