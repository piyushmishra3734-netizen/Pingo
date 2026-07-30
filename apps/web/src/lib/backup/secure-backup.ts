/**
 * Secure Backup: enrolling, disabling, and reporting what is true.
 *
 * Enrolment is deliberately two steps. `begin` generates the code and the key
 * material and writes nothing anywhere; `complete` is what reaches the network.
 * Anything that happens between them — the user closing the sheet, backing out,
 * never writing the code down — leaves no trace, which is the only honest
 * meaning of "cancel" for an operation whose whole point is that the user has
 * kept a secret.
 *
 * The reverse would be worse in a specific way: a package uploaded before the
 * user has saved the code enrols them in a recovery they cannot perform, and
 * they would not find out until the day they needed it.
 */
import {
  createRecoveryKey,
  generateRecoveryCode,
  type RecoveryPackage,
} from '../crypto/recovery.js';
import { openRecord, sealRecord } from '../crypto/session.js';
import { STORE, localDelete, localGet, localSet } from '../local/db.js';
import type { BackupTarget, TargetStatus } from './target.js';

const STATE_KEY = 'secure-backup';

/** What this device remembers about enrolment, sealed like everything else. */
export interface SecureBackupState {
  enabled: boolean;
  /** Package version this device last wrote. Rotation increments it. */
  version: number;
  /** The public half, so the UI can show enrolment without a round trip. */
  publicKey: string;
  enrolledAt: number;
  /** Set when an archive was last written. Unused until Drive exists. */
  lastBackupAt?: number;
}

/** Material produced by `begin`, held only in memory until `complete`. */
export interface PendingEnrolment {
  code: string;
  package: RecoveryPackage;
  publicKey: string;
  privateKey: CryptoKey;
}

export interface SecureBackupStatus {
  /** True only when this device has enrolled and a target confirms it. */
  enabled: boolean;
  /** What this device recorded locally, if anything. */
  local?: SecureBackupState;
  /** Per-target truth, so a target that has fallen behind is visible. */
  targets: Array<TargetStatus & { id: string; label: string }>;
  /**
   * Set when local state and every target disagree.
   *
   * Reported rather than resolved. A device that says it enrolled while no
   * target holds a package is a real condition the user needs to see, not a
   * discrepancy to paper over by trusting whichever side is more convenient.
   */
  mismatch?: string;
}

/**
 * Where enrolment state lives.
 *
 * Injected rather than reached for directly, because the sealed IndexedDB store
 * is a browser thing and this logic is not. Verification supplies an in-memory
 * one and exercises the real functions; a future target running somewhere
 * without IndexedDB can supply its own without this file learning about it.
 */
export interface StateStore {
  read(): Promise<SecureBackupState | undefined>;
  write(state: SecureBackupState): Promise<void>;
  clear(): Promise<void>;
}

/** The shipping store: sealed with the device database key, like everything else. */
export const sealedStateStore: StateStore = {
  async read() {
    return openRecord<SecureBackupState>(await localGet<unknown>(STORE.meta, STATE_KEY));
  },
  async write(state) {
    await localSet(STORE.meta, STATE_KEY, await sealRecord(state));
  },
  async clear() {
    await localDelete(STORE.meta, STATE_KEY);
  },
};

export async function readState(
  store: StateStore = sealedStateStore,
): Promise<SecureBackupState | undefined> {
  return store.read();
}

/**
 * Step one: make the material. Nothing leaves the device.
 *
 * The version is one past whatever this device last wrote, so re-enrolling is a
 * rotation the replay defence in `restoreRecoveryKey` will accept and an older
 * package cannot be replayed over.
 */
export async function beginEnrolment(
  store: StateStore = sealedStateStore,
): Promise<PendingEnrolment> {
  const previous = await readState(store);
  const code = generateRecoveryCode();
  const created = await createRecoveryKey(code, (previous?.version ?? 0) + 1);

  return {
    code,
    package: created.package,
    publicKey: created.publicKey,
    privateKey: created.privateKey,
  };
}

export class EnrolmentError extends Error {
  constructor(
    message: string,
    readonly code: 'write-failed' | 'not-confirmed',
  ) {
    super(message);
    this.name = 'EnrolmentError';
  }
}

/**
 * Step two: publish the package, then prove it took.
 *
 * The read-back is not ceremony. `put` resolving means the write was accepted,
 * not that a later reader will find it — an RLS policy that silently filtered
 * the row, or a target that accepted and dropped it, both look like success
 * from here. Enrolment that cannot be confirmed is reported as failure, because
 * the alternative is a switch that says "on" over nothing.
 */
export async function completeEnrolment(
  pending: PendingEnrolment,
  targets: BackupTarget[],
  store: StateStore = sealedStateStore,
): Promise<SecureBackupState> {
  const stored = { package: pending.package, publicKey: pending.publicKey };

  const failures: string[] = [];
  for (const target of targets) {
    try {
      await target.put(stored);
    } catch (cause) {
      failures.push(`${target.label}: ${cause instanceof Error ? cause.message : 'failed'}`);
    }
  }

  if (failures.length === targets.length) {
    throw new EnrolmentError(
      `Secure Backup could not be enabled. ${failures.join('; ')}`,
      'write-failed',
    );
  }

  const confirmed = await Promise.all(targets.map((t) => t.status()));
  if (!confirmed.some((s) => s.present)) {
    throw new EnrolmentError(
      'Secure Backup was written but no target confirmed it. Nothing has been enabled.',
      'not-confirmed',
    );
  }

  const state: SecureBackupState = {
    enabled: true,
    version: pending.package.version,
    publicKey: pending.publicKey,
    enrolledAt: Date.now(),
  };

  await store.write(state);
  return state;
}

/**
 * Turn it off, and stop new messages being wrapped to a key nobody holds.
 *
 * Removing the public key from the targets is the part that matters: senders
 * read it to decide whether to add a recovery wrap, so a package left behind
 * would keep every future message wrapped for a key the user has discarded.
 *
 * Local state is cleared even when a target refuses, and the refusal is
 * returned. A device that keeps claiming to be enrolled after the user turned
 * it off is worse than one that reports a target it could not reach.
 */
export async function disableSecureBackup(
  targets: BackupTarget[],
  store: StateStore = sealedStateStore,
): Promise<{ removed: boolean; problems: string[] }> {
  const problems: string[] = [];

  for (const target of targets) {
    try {
      await target.remove();
    } catch (cause) {
      problems.push(`${target.label}: ${cause instanceof Error ? cause.message : 'failed'}`);
    }
  }

  await store.clear();
  return { removed: problems.length === 0, problems };
}

export async function secureBackupStatus(
  targets: BackupTarget[],
  store: StateStore = sealedStateStore,
): Promise<SecureBackupStatus> {
  const local = await readState(store);
  const statuses = await Promise.all(
    targets.map(async (target) => ({
      id: target.id,
      label: target.label,
      ...(await target.status()),
    })),
  );

  const anyPresent = statuses.some((s) => s.present);
  const reachable = statuses.some((s) => !s.error);

  let mismatch: string | undefined;
  if (local?.enabled && !anyPresent && reachable) {
    mismatch = 'This device has a recovery key but the server has no package for it.';
  } else if (!local?.enabled && anyPresent) {
    mismatch = 'Secure Backup is enabled on your account but not set up on this device.';
  }

  return {
    enabled: Boolean(local?.enabled) && anyPresent,
    local,
    targets: statuses,
    mismatch,
  };
}
