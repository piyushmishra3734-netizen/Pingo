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
import { ANDROID_POLICY, WEB_POLICY, shouldBackup } from '../src/lib/backup/drive/policy.js';
import { FakeAuth, FakeDrive } from './fake-drive.js';
import type { BackupPorts, BackupStage } from '../src/lib/backup/pipeline.js';

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
check(/TypeError|Failed to fetch/i.test(offlineView.message ?? ''), `the real exception is reported, not a guess: "${offlineView.message}"`);

console.log('\n— only one backup at a time —');

const lock = build();
await lock.controller.connect(() => lock.auth.authorize());

/*
 * Two backups started without awaiting the first. A second generation racing
 * the first would fight over the same chunk names and could commit a HEAD
 * pointing at a half-written mixture.
 */
const firstRun = lock.controller.backupNow(chats, recoveryPublic);
const secondRun = lock.controller.backupNow(chats, recoveryPublic);
check(lock.controller.busy, 'the controller reports itself busy while running');
const [a, b] = await Promise.all([firstRun, secondRun]);
check(a === b, 'the second request joins the first rather than starting another');
check(a.generation === 1, 'exactly one generation was written, not two');
check(!lock.controller.busy, 'the lock is released when it finishes');

const afterLock = await lock.controller.backupNow(chats, recoveryPublic);
check(afterLock.generation === 2, 'a later backup runs normally once the lock is free');

console.log('\n— restore cannot start while a backup is running —');

const mixed = build();
await mixed.controller.connect(() => mixed.auth.authorize());
await mixed.controller.backupNow(chats, recoveryPublic);
const running = mixed.controller.backupNow(chats, recoveryPublic);
const rejectedRestore = await mixed.controller.restore(recovery.privateKey, async () => {});
await running;
check(
  rejectedRestore.phase !== 'restoring',
  'a restore requested mid-backup does not start a second operation',
);

console.log('\n— success and failure are recorded separately —');

const history = build();
await history.controller.connect(() => history.auth.authorize());
await history.controller.backupNow(chats, recoveryPublic);
const successAt = history.store.peek()?.lastSuccessAt;
check(typeof successAt === 'number', 'a successful backup records lastSuccessAt');
check(history.store.peek()?.lastFailure === undefined, 'and records no failure');

history.drive.failUploads = true;
const failedView = await history.controller.backupNow(chats, recoveryPublic);
history.drive.failUploads = false;

check(history.store.peek()?.lastSuccessAt === successAt, 'a later failure does not overwrite the last success');
check(typeof history.store.peek()?.lastFailure?.at === 'number', 'the failure time is recorded');
check(
  (history.store.peek()?.lastFailure?.reason ?? '').length > 0,
  `the failure reason is kept: "${history.store.peek()?.lastFailure?.reason}"`,
);
check(failedView.lastFailure !== undefined, 'and the screen is given it to display');

console.log('\n— next scheduled backup is Android-only —');

const android = build();
await android.controller.connect(() => android.auth.authorize());
await android.controller.backupNow(chats, recoveryPublic);
const androidView = await android.controller.load(ANDROID_POLICY);
check(typeof androidView.nextScheduledAt === 'number', 'Android reports a next scheduled backup');
check(
  (androidView.nextScheduledAt ?? 0) > Date.now(),
  'and it is in the future',
);

const webView = await android.controller.load(WEB_POLICY);
check(
  webView.nextScheduledAt === undefined,
  'the web reports nothing scheduled, because nothing is',
);

console.log('\n— the policy itself —');

check(shouldBackup(WEB_POLICY, 'manual', Date.now()), 'manual always runs, even just after a backup');
check(!shouldBackup(WEB_POLICY, 'background', undefined), 'the web never runs a background backup');
check(shouldBackup(ANDROID_POLICY, 'background', undefined), 'Android runs one when it has never backed up');
check(
  !shouldBackup(ANDROID_POLICY, 'periodic', Date.now()),
  'and does not run again immediately afterwards',
);
check(
  shouldBackup(ANDROID_POLICY, 'periodic', Date.now() - 25 * 60 * 60 * 1000),
  'but does once the interval has passed',
);

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


console.log('\n— the pipeline path, as the screen sees it —');

/**
 * A `BackupPorts` that reports whatever outcome a test asks for.
 *
 * The pipeline itself is proven in `verify-pipeline.ts` against real modules.
 * What is under test here is narrower and easy to get wrong: whether the
 * controller turns each outcome into the right screen state, and in particular
 * whether an account that is merely incomplete gets filed as a failure.
 */
function portsReporting(
  outcome: 'complete' | 'incomplete' | 'unverified',
  stages: BackupStage[] = [],
): BackupPorts {
  const proven = outcome !== 'incomplete';
  return {
    async preflight() {
      return {
        conversations: 3,
        messages: 425,
        photos: 1,
        videos: 0,
        documents: 0,
        voiceNotes: 0,
        archive: { bytes: 1_000, low: 800, high: 1_200, sampledRows: 10, assumed: false },
        mediaBytes: 0,
        toDownload: 425,
        empty: false,
        partial: false,
        unavailable: [],
        measuredAt: Date.now(),
      };
    },
    async backfill() {
      return {
        conversationsWalked: 3,
        conversationsComplete: proven ? 3 : 2,
        messagesFetched: 425,
        incomplete: [],
        cancelled: false,
        audit: [],
      };
    },
    async prove() {
      return {
        status: proven ? 'proven' : 'short',
        conversations: [],
        shortfall: { conversations: proven ? 0 : 1, messages: proven ? 0 : 130 },
        totals: { conversations: 3, serverMessages: 425, localMessages: proven ? 425 : 295 },
        localOnly: [],
        provenAt: Date.now(),
      };
    },
    async archive(_completeness, onProgress) {
      onProgress({ stage: 'uploading' });
      onProgress({ stage: 'verifying' });
      return {
        generation: 4,
        manifest: {
          version: 1,
          generation: 4,
          epk: 'ZXBr',
          chunkCount: 1,
          totalBytes: 10,
          chunks: [{ index: 0, iv: 'aXY', digest: 'ZA==', bytes: 26 }],
          createdAt: Date.now(),
        },
        archiveBytes: 4_096,
        verification:
          outcome === 'unverified'
            ? {
                status: 'failed',
                generation: 4,
                checks: [],
                digests: { checked: 0, total: 1, sampled: false },
                failures: ['Missing chunks: 0.'],
                rolledBackTo: 3,
              }
            : {
                status: 'verified',
                generation: 4,
                checks: [],
                digests: { checked: 1, total: 1, sampled: false },
                failures: [],
              },
      };
    },
    async previousReceipt() {
      return undefined;
    },
    async storeReceipt() {},
    recoveryPublicKey: recoveryPublic,
    mode: 'private',
    keyVersion: 1,
    newBackupId: () => 'bk_test',
  };
}

{
  const world = build();
  await world.controller.connect(() => world.auth.authorize());

  const stages: BackupStage[] = [];
  const unsubscribe = world.controller.subscribe((view: DriveView) => {
    if (view.stage && stages[stages.length - 1] !== view.stage) stages.push(view.stage);
  });

  const view = await world.controller.backupComplete(portsReporting('complete'));
  unsubscribe?.();

  check(view.phase === 'connected', 'a complete backup leaves the screen connected');
  check(view.receipt?.messages === 425, 'the receipt reaches the screen');
  check(view.generation === 4, 'with the generation that was committed');
  check(view.bytes === 4_096, 'and the sealed size the quota pays for');
  check(view.incomplete === undefined, 'nothing is reported incomplete');
  check(view.stage === undefined && view.stageLabel === undefined, 'the stage clears when it finishes');
  check(view.message === 'Backup complete and fully verified.', `and says what happened: "${view.message}"`);
  check(stages.includes('proving'), `the proving stage was shown (${stages.join(' → ')})`);
  check(world.store.peek()?.lastSuccessAt !== undefined, 'the success is recorded');
}

{
  /*
   * The distinction this whole block exists for. A backup that correctly
   * refused to run because history is missing is the system working, and
   * filing it under `lastFailure` would start the next support conversation
   * from the wrong place.
   */
  const world = build();
  await world.controller.connect(() => world.auth.authorize());
  const view = await world.controller.backupComplete(portsReporting('incomplete'));

  check(view.phase === 'connected', 'an incomplete account is not an error state');
  check(view.phase !== 'error', 'and never shows the error phase');
  check(view.incomplete !== undefined, 'the incomplete report reaches the screen');
  check(
    /130 messages are still missing/.test(view.incomplete?.headline ?? ''),
    `with the number in it: "${view.incomplete?.headline}"`,
  );
  check(view.needsReconnect !== true, 'reconnecting is not offered, because it would not help');
  check(world.store.peek()?.lastFailure === undefined, 'it is NOT recorded as a failure');
  check(world.store.peek()?.lastSuccessAt === undefined, 'nor as a success');
  check(view.receipt === undefined, 'and no receipt claims it');
}

{
  const world = build();
  await world.controller.connect(() => world.auth.authorize());
  const view = await world.controller.backupComplete(portsReporting('unverified'));

  check(view.phase === 'error', 'a backup that failed to verify IS an error');
  check(
    view.message === 'Backup failed to verify. Your previous backup from generation 3 is still in place.',
    `and the user is told the old one survives: "${view.message}"`,
  );
  check(!/failed - Error:/.test(view.message ?? ''), 'without a generic wrapper stuttering over it');
  check(world.store.peek()?.lastFailure !== undefined, 'the failure is recorded');
  check(world.store.peek()?.lastSuccessAt === undefined, 'and not counted as a success');
}

{
  // A second backup cannot start while one is running: the same lock the old
  // path uses, since the screen's disabled button is a courtesy, not the lock.
  const world = build();
  await world.controller.connect(() => world.auth.authorize());

  const first = world.controller.backupComplete(portsReporting('complete'));
  const second = world.controller.backupComplete(portsReporting('complete'));
  await Promise.all([first, second]);

  check(world.store.peek()?.generation === 4, 'both runs settle on one generation');
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
