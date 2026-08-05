/**
 * Secure Backup enrolment, exercised as shipped.
 *
 * The real `beginEnrolment`, `completeEnrolment`, `disableSecureBackup` and
 * `secureBackupStatus` are imported and run. Only two things stand in: the
 * target, which is in-memory instead of PostgREST, and the state store, which
 * is a Map instead of sealed IndexedDB. Both are injected through the same
 * interfaces the shipping code uses, so the logic under test is the logic that
 * runs on a device.
 *
 * The case that matters most is cancellation. An enrolment that reaches the
 * network before the user has written the code down enrols them in a recovery
 * they cannot perform, and they find out on the day they need it.
 *
 * Run with `pnpm verify:secure-backup`.
 */
import { restoreRecoveryKey } from '../src/lib/crypto/recovery.js';
import {
  EnrolmentError,
  beginEnrolment,
  completeEnrolment,
  disableSecureBackup,
  readState,
  secureBackupStatus,
  testRecovery,
  type SecureBackupState,
  type StateStore,
} from '../src/lib/backup/secure-backup.js';
import type { BackupTarget, StoredPackage, TargetStatus } from '../src/lib/backup/target.js';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
};

/** A target that behaves, and can be told to misbehave. */
class MemoryTarget implements BackupTarget {
  readonly id = 'server' as const;
  readonly label = 'test target';
  stored: StoredPackage | undefined;
  failWrites = false;
  /** Accepts writes but never shows them again — the silent-drop case. */
  swallow = false;

  async put(stored: StoredPackage): Promise<void> {
    if (this.failWrites) throw new Error('refused');
    if (!this.swallow) this.stored = stored;
  }
  async get(): Promise<StoredPackage | undefined> {
    return this.stored;
  }
  async remove(): Promise<void> {
    this.stored = undefined;
  }
  async status(): Promise<TargetStatus> {
    return this.stored
      ? { present: true, version: this.stored.package.version }
      : { present: false };
  }
}

/** The state store, in memory. Survives across calls like the sealed one does. */
function memoryStore(): StateStore & { peek: () => SecureBackupState | undefined } {
  let held: SecureBackupState | undefined;
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

console.log('— first-time enrolment —');

const store = memoryStore();
const target = new MemoryTarget();

check((await readState(store)) === undefined, 'nothing enrolled to begin with');
check(!(await secureBackupStatus([target], store)).enabled, 'status reports disabled');

const pending = await beginEnrolment('a passcode the user chose', store);
/*
 * The secret is the user's now, not a generated one. What matters is that the
 * package is sealed to what they chose — a check that it came back as twelve
 * words was a check on the old design.
 */
check(pending.code === 'a passcode the user chose', 'begin seals to the secret it was given');
check(pending.package.version === 1, 'first package is version 1');

/*
 * The point of the two-step split: begin must not have touched anything.
 */
check(target.stored === undefined, 'begin writes nothing to the target');
check(store.peek() === undefined, 'begin writes nothing locally');

const state = await completeEnrolment(pending, [target], store);
check(state.enabled, 'complete returns an enabled state');
check(target.stored !== undefined, 'the package reached the target');
check(
  target.stored?.publicKey === pending.publicKey,
  'the public key senders wrap to is registered',
);

const enrolled = await secureBackupStatus([target], store);
check(enrolled.enabled, 'status reports enabled');
check(enrolled.mismatch === undefined, 'no mismatch reported');

console.log('\n— the enrolled code actually opens the package —');

const opened = await restoreRecoveryKey(target.stored!.package, pending.code);
check(Boolean(opened), 'the registered package opens with the code shown to the user');

console.log('\n— cancellation leaves no trace —');

const cancelStore = memoryStore();
const cancelTarget = new MemoryTarget();
const abandoned = await beginEnrolment('a passcode the user chose', cancelStore);
check(abandoned.code.length > 0, 'a code was generated');
// The user closes the sheet. `completeEnrolment` is never called.
check(cancelTarget.stored === undefined, 'cancelled enrolment wrote nothing to the target');
check(cancelStore.peek() === undefined, 'cancelled enrolment wrote nothing locally');
check(
  !(await secureBackupStatus([cancelTarget], cancelStore)).enabled,
  'still reports disabled after cancelling',
);

console.log('\n— enrolment that cannot be confirmed is a failure —');

const swallowStore = memoryStore();
const swallowing = new MemoryTarget();
swallowing.swallow = true;
const swallowPending = await beginEnrolment('a passcode the user chose', swallowStore);
let notConfirmed = false;
try {
  await completeEnrolment(swallowPending, [swallowing], swallowStore);
} catch (cause) {
  notConfirmed = cause instanceof EnrolmentError && cause.code === 'not-confirmed';
}
check(notConfirmed, 'a target that accepts and drops the package fails enrolment');
check(swallowStore.peek() === undefined, 'and nothing is recorded as enabled');

const refusingStore = memoryStore();
const refusing = new MemoryTarget();
refusing.failWrites = true;
let writeFailed = false;
try {
  await completeEnrolment(await beginEnrolment('a passcode the user chose', refusingStore), [refusing], refusingStore);
} catch (cause) {
  writeFailed = cause instanceof EnrolmentError && cause.code === 'write-failed';
}
check(writeFailed, 'a target that refuses the write fails enrolment');

console.log('\n— re-enrolment rotates rather than repeats —');

const second = await beginEnrolment('something different this time', store);
check(second.package.version === 2, 'the next package is version 2');
check(second.code !== pending.code, 'sealed to the new secret, not the old one');

await completeEnrolment(second, [target], store);
check(target.stored?.package.version === 2, 'the target holds the newer package');

const rotated = await restoreRecoveryKey(target.stored!.package, second.code);
check(Boolean(rotated), 'the new code opens the new package');

let oldRefused = false;
try {
  await restoreRecoveryKey(target.stored!.package, pending.code);
} catch {
  oldRefused = true;
}
check(oldRefused, 'the old secret does not open the new package');

console.log('\n— status persists —');

check((await readState(store))?.version === 2, 'version survives in the store');
check((await readState(store))?.enabled === true, 'enabled survives in the store');
check(
  typeof (await readState(store))?.enrolledAt === 'number',
  'enrolment time is recorded',
);

console.log('\n— test recovery is a rehearsal, not a restore —');

const good = await testRecovery(second.code, [target], store);
check(good.ok, 'the current code passes');
check(good.ok && good.version === 2, 'and reports the version it opened');
check(target.stored !== undefined, 'testing does not remove the package');
check((await readState(store))?.enabled === true, 'testing does not change enrolment');

const bad = await testRecovery(pending.code, [target], store);
check(!bad.ok && bad.reason === 'bad-code', 'a superseded secret fails');

const emptyStore = memoryStore();
const emptyTarget = new MemoryTarget();
const nothing = await testRecovery('whatever words these are', [emptyTarget], emptyStore);
check(!nothing.ok && nothing.reason === 'no-package', 'with nothing enrolled there is nothing to test');

/*
 * The server cannot hand the package back, so the device copy has to stand in.
 * A target that returns undefined must fall through rather than fail.
 */
const silentTarget = new MemoryTarget();
silentTarget.get = async () => undefined;
const viaDeviceCopy = await testRecovery(second.code, [silentTarget], store);
check(viaDeviceCopy.ok, 'falls back to the sealed device copy when a target cannot return one');
check(viaDeviceCopy.ok && viaDeviceCopy.source === 'device', 'and says which copy it checked');

console.log('\n— disable —');

const off = await disableSecureBackup([target], store);
check(off.removed, 'disable reports success');
check(target.stored === undefined, 'the package is gone from the target');
check((await readState(store)) === undefined, 'local state is cleared');
check(!(await secureBackupStatus([target], store)).enabled, 'status reports disabled');

/*
 * A target that refuses removal must still switch the device off. A device that
 * keeps claiming to be enrolled after the user turned it off is the worse of
 * the two failures.
 */
const stubbornStore = memoryStore();
const stubborn = new MemoryTarget();
await completeEnrolment(await beginEnrolment('a passcode the user chose', stubbornStore), [stubborn], stubbornStore);
stubborn.remove = async () => {
  throw new Error('offline');
};
const partial = await disableSecureBackup([stubborn], stubbornStore);
check(!partial.removed, 'a refusing target is reported');
check(partial.problems.length === 1, 'and the reason is returned');
check((await readState(stubbornStore)) === undefined, 'the device is switched off regardless');

console.log('\n— mismatch is reported, not papered over —');

const orphanStore = memoryStore();
const orphanTarget = new MemoryTarget();
await orphanStore.write({
  enabled: true,
  version: 1,
  publicKey: 'nope',
  enrolledAt: Date.now(),
});
const orphan = await secureBackupStatus([orphanTarget], orphanStore);
check(!orphan.enabled, 'local-only enrolment does not report enabled');
check(Boolean(orphan.mismatch), 'the disagreement is surfaced');

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
