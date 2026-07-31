/**
 * Where a recovery package can be kept.
 *
 * There is exactly one target today - the PINGO server - and Google Drive is
 * meant to become a second one without anything above this file changing. So
 * the interface is written for the general case now, while there is only one
 * implementation to keep honest, rather than discovered later by refactoring
 * around a shape that assumed a single home.
 *
 * A target stores an opaque blob and hands it back. It never sees a recovery
 * code, never sees plaintext, and cannot open what it holds. That is what makes
 * "add another target" a small change rather than a security review.
 */
import type { RecoveryPackage } from '../crypto/recovery.js';

/** What a target knows about the package it is holding. */
export interface TargetStatus {
  /** Whether this target currently holds a package at all. */
  present: boolean;
  /**
   * The package version this target holds, when it knows it.
   *
   * Used to spot a target that has fallen behind after a rotation, and to
   * refuse a package older than one already seen.
   */
  version?: number;
  /** When this target last accepted a write, if it records that. */
  updatedAt?: number;
  /**
   * Set when the target could not be reached or refused the operation.
   *
   * A target that is merely unreachable must be distinguishable from one that
   * is genuinely empty: the first is a retry, the second means the user is not
   * enrolled. Collapsing them would let a network blip read as "no backup".
   */
  error?: string;
}

/** The public half plus the sealed package, as a target stores them. */
export interface StoredPackage {
  package: RecoveryPackage;
  publicKey: string;
}

export interface BackupTarget {
  /** Stable identifier, used in status reporting and logs. */
  readonly id: 'server' | 'drive';
  /** What to call this in the interface. */
  readonly label: string;

  /**
   * Store a package, replacing any earlier one.
   *
   * Implementations must not blindly overwrite a newer version with an older
   * one; the version in `RecoveryPackage` is what makes that checkable.
   */
  put(stored: StoredPackage): Promise<void>;

  /**
   * Fetch the stored package, if this target can return one.
   *
   * The server target cannot: `recovery_packages.package` is not selectable by
   * any client role, by design, and is claimed through the recovery request
   * flow instead. It returns undefined and says so through `status()`.
   */
  get(): Promise<StoredPackage | undefined>;

  /** Remove the package. Used when Secure Backup is switched off. */
  remove(): Promise<void>;

  status(): Promise<TargetStatus>;
}
