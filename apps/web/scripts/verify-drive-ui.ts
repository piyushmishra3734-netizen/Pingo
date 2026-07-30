/**
 * The states the Secure Backup screen can be in.
 *
 * Driven through the controller the screen renders, so these are the same
 * transitions a person would produce by tapping. What is not covered is
 * pixels — this says the screen will be told "token expired, offer reconnect",
 * not that the button is legible.
 *
 * Run with `pnpm verify:drive-ui`.
 */
import { DriveBackupController, type DriveBackupState, type DriveStateStore, type DriveView } from '../src/lib/backup/drive/controller.js';
import { GoogleDriveBackupTarget } from '../src/lib/backup/drive/drive-target.js';
import { DriveAuthError } from '../src/lib/backup/drive/auth.js';
import { FakeAuth, FakeDrive } from './fake-drive.js';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
};

function memoryStore(): DriveStateStore & { peek: () => DriveBackupState | undefined } {
  let held: DriveBackupState | undefined;
  return {
    async read() {
      return held;
    },
    async write(state) {
      held = state;
    },
    async clear() {
      held = undefined;
    },
    peek: () => held,
  };
}

const recovery = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
  'deriveKey',
  'deriveBits',
]);
const recoveryPublic = Buffer.from(
  new Uint8Array(await crypto.subtle.exportKey('spki', recovery.publicKey)),
).toString('base64');

const chats = new Uint8Array(5 * 1024 * 1024).fill(7);

const build = () => {
  const drive = new FakeDrive();
  const auth = new FakeAuth();
  const target = new GoogleDriveBackupTarget(auth, drive.http);
  const store = memoryStore();
  return { drive, auth, target, store, controller: new DriveBackupController(target, store) };
};

console.log('— disconnected —');

const fresh = build();
const initial = await fresh.controller.load();
check(initial.phase === 'disconnected', 'starts disconnected');
check(initial.connected === false, 'reports not connected');
check(initial.lastBackupAt === undefined, 'no last backup time');
check(initial.generation === undefined, 'no generation');

console.log('\n— connected —');

const connected = await fresh.controller.connect(() => fresh.auth.authorize());
check(connected.phase === 'connected', 'connecting succeeds');
check(connected.connected === true, 'reports connected');
check(fresh.store.peek()?.connected === true, 'and the state persists');

const reloaded = await fresh.controller.load();
check(reloaded.connected === true, 'still connected after a reload');

console.log('\n— backup in progress, then completed —');

const seen: DriveView[] = [];
const stop = fresh.controller.subscribe((view) => seen.push({ ...view }));
const done = await fresh.controller.backupNow(chats, recoveryPublic);
stop();

check(seen.some((v) => v.phase === 'backing-up'), 'the screen is told a backup started');
check(
  seen.some((v) => v.progress?.phase === 'uploading'),
  'progress is reported while uploading',
);
check(
  seen.some((v) => v.progress?.phase === 'committing'),
  'and again while committing',
);
check(done.phase === 'connected', 'it ends back at connected');
check(done.generation === 1, 'generation is shown');
check(typeof done.bytes === 'number' && done.bytes > chats.length, 'backup size is reported (sealed, so larger)');
check(typeof done.lastBackupAt === 'number', 'last backup time is recorded');
check(done.progress === undefined, 'progress is cleared when finished');

console.log('\n— a second backup moves the generation —');

const again = await fresh.controller.backupNow(chats, recoveryPublic);
check(again.generation === 2, 'generation increments in the UI state');

console.log('\n— restore completed —');

let applied: Uint8Array | undefined;
const restored = await fresh.controller.restore(recovery.privateKey, async (plaintext) => {
  applied = plaintext;
});
check(restored.phase === 'connected', 'restore ends at connected');
check(applied !== undefined, 'the restored bytes are handed to the caller');
check(
  applied !== undefined && Buffer.compare(Buffer.from(applied), Buffer.from(chats)) === 0,
  'and they are byte-identical to what was backed up',
);

console.log('\n— restore that cannot be applied is not recorded as done —');

const applyFails = build();
await applyFails.controller.connect(() => applyFails.auth.authorize());
await applyFails.controller.backupNow(chats, recoveryPublic);
const generationBefore = applyFails.store.peek()?.generation;
const failedApply = await applyFails.controller.restore(recovery.privateKey, async () => {
  throw new Error('local database is full');
});
check(failedApply.phase === 'error', 'a failed apply is an error');
check(
  applyFails.store.peek()?.generation === generationBefore,
  'and the generation is not advanced, so the next attempt is not refused as a rollback',
);

console.log('\n— token expired —');

const expired = build();
await expired.controller.connect(() => expired.auth.authorize());
expired.auth.canRefresh = false;
const expiredView = await expired.controller.backupNow(chats, recoveryPublic);
check(expiredView.phase === 'error', 'an expired token is an error state');
check(expiredView.needsReconnect === true, 'and the screen is told to offer reconnect');
check(/expired|reconnect/i.test(expiredView.message ?? ''), `message says so: "${expiredView.message}"`);

console.log('\n— cancelled at the account picker —');

const cancelled = build();
const cancelledView = await cancelled.controller.connect(() => {
  throw new DriveAuthError('user closed it', 'cancelled');
});
check(cancelledView.phase === 'error', 'cancelling is surfaced');
check(cancelledView.connected === false, 'and does not leave the screen looking connected');
check(cancelled.store.peek() === undefined, 'nothing is persisted');

console.log('\n— upload failed —');

const failing = build();
await failing.controller.connect(() => failing.auth.authorize());
failing.drive.failUploads = true;
const uploadFailed = await failing.controller.backupNow(chats, recoveryPublic);
check(uploadFailed.phase === 'error', 'an upload failure is an error state');
check(uploadFailed.needsReconnect !== true, 'and is not mistaken for an auth problem');
check(failing.store.peek()?.lastBackupAt === undefined, 'no last-backup time is recorded for a backup that failed');

console.log('\n— network unavailable —');

const offline = build();
await offline.controller.connect(() => offline.auth.authorize());
const offlineTarget = new GoogleDriveBackupTarget(offline.auth, async () => {
  // What fetch does with no network: it rejects, it does not resolve.
  throw new TypeError('Failed to fetch');
});
const offlineController = new DriveBackupController(offlineTarget, offline.store);
const offlineView = await offlineController.backupNow(chats, recoveryPublic);
check(offlineView.phase === 'error', 'being offline is an error state');
check(offlineView.needsReconnect !== true, 'and does not ask the user to reconnect Drive');
check(/connection|online/i.test(offlineView.message ?? ''), `message is about the network: "${offlineView.message}"`);

console.log('\n— disconnected again —');

const gone = await fresh.controller.disconnect();
check(gone.phase === 'disconnected', 'disconnect returns to disconnected');
check(gone.connected === false, 'reports not connected');
check(gone.lastBackupAt === undefined, 'last backup time is cleared');
check(gone.generation === undefined, 'generation is cleared');
check(fresh.store.peek() === undefined, 'persisted state is cleared');
check(fresh.drive.files.size === 0, 'and the blobs are removed from Drive');

console.log('\n— disconnect works even when Drive cannot be reached —');

const stubborn = build();
await stubborn.controller.connect(() => stubborn.auth.authorize());
await stubborn.controller.backupNow(chats, recoveryPublic);
stubborn.drive.http = async () => {
  throw new TypeError('Failed to fetch');
};
const stubbornGone = await stubborn.controller.disconnect();
check(stubbornGone.phase === 'disconnected', 'the device disconnects regardless');
check(stubborn.store.peek() === undefined, 'and stops claiming to be connected');

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
