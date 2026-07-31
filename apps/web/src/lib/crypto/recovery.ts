import { generateMnemonic, mnemonicToEntropy, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';

import { fromBase64, toBase64 } from './keys.js';

/**
 * The recovery key, and the code that unlocks it.
 *
 * Read the plan before changing anything here: docs/e2ee-recovery-plan.md.
 *
 * Two rules govern this file and neither is negotiable.
 *
 * 1. **The device identity key is never touched.** It stays non-extractable
 *    forever. This module creates a *separate* key whose only job is recovery,
 *    and which is never used to send, sign or authenticate.
 * 2. **The recovery key is exportable for one straight-line block and no
 *    longer.** Generate, export, wrap, re-import non-extractable, drop. There
 *    is no `await` on anything remote inside that window.
 */

/** Named in the stored package so Argon2id can replace this without a migration. */
export const KDF = 'pbkdf2-sha256-600000';
const PBKDF2_ITERATIONS = 600_000;

/** 128 bits - twelve words. */
const ENTROPY_BITS = 128;

export interface RecoveryPackage {
  version: number;
  kdf: string;
  salt: string;
  iv: string;
  /** The wrapped private key. Opaque to the server, forever. */
  package: string;
}

// -- the code --------------------------------------------------------------

/**
 * Twelve words from the BIP-39 English list.
 *
 * Generated, never chosen. A passphrase somebody invents is reused, guessable,
 * and guards everything here; 128 bits from `crypto.getRandomValues` is not.
 * The wordlist is BIP-39 rather than something bespoke because it is widely
 * reviewed, the words are unambiguous spoken and written, and it carries a
 * checksum - which turns the commonest failure from "wrong key, no
 * explanation" into "word seven is not a word".
 */
export function generateRecoveryCode(): string {
  return generateMnemonic(wordlist, ENTROPY_BITS);
}

/** Checks the checksum. Runs before the KDF, so a typo costs nothing. */
export function isValidRecoveryCode(code: string): boolean {
  try {
    return validateMnemonic(normaliseRecoveryCode(code), wordlist);
  } catch {
    return false;
  }
}

/**
 * What people actually type: stray spaces, capitals, and a newline from a
 * paste. None of that should be the difference between recovering an account
 * and not.
 */
export function normaliseRecoveryCode(code: string): string {
  return code.trim().toLowerCase().split(/\s+/u).join(' ');
}

/**
 * Which word is wrong, when one is.
 *
 * Returned as indices so the UI can mark the offending box rather than
 * rejecting twelve words as a unit. A code that fails only its checksum has no
 * single bad word - the words are all real and their order or content is not  - 
 * so that case returns an empty list and the caller says so differently.
 */
export function unknownWords(code: string): number[] {
  const known = new Set(wordlist);
  return normaliseRecoveryCode(code)
    .split(' ')
    .map((word, index) => (word.length > 0 && !known.has(word) ? index : -1))
    .filter((index) => index >= 0);
}

// -- wrapping --------------------------------------------------------------

/**
 * Turns the code into a wrapping key.
 *
 * PBKDF2 rather than Argon2id, deliberately and reversibly. With a generated
 * 128-bit code the entropy is doing all the work - brute force is infeasible
 * at any iteration count - and memory-hardness defends against weak *human*
 * secrets, which this design never allows because it never lets anyone choose
 * one. `KDF` names the choice in every stored package, so Argon2id can arrive
 * later without orphaning a single existing user.
 */
async function wrappingKey(code: string, salt: ArrayBuffer): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(normaliseRecoveryCode(code)),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Creates the recovery key and the package that carries it.
 *
 * The returned `publicKey` is what senders wrap message content keys to. The
 * returned `privateKey` is already non-extractable - the exportable instance
 * existed only inside this function and is gone by the time it returns.
 */
export async function createRecoveryKey(
  code: string,
  version = 1,
): Promise<{ package: RecoveryPackage; publicKey: string; privateKey: CryptoKey }> {
  /*
   * Extractable, for the next four statements.
   *
   * This is the one moment the design permits it, and it is bounded by
   * straight-line code with no network call in the middle. Adding an `await`
   * on anything remote between here and the re-import would widen the window
   * from microseconds to however long a request takes, so: do not.
   */
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveKey',
    'deriveBits',
  ]);

  const raw = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await wrappingKey(code, salt.buffer as ArrayBuffer);
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, raw);

  // Re-imported locked. From here the recovery key is exactly as unexportable
  // as the identity key beside it.
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    raw.buffer as ArrayBuffer,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveKey', 'deriveBits'],
  );

  /*
   * Overwritten before it is dropped. Best-effort and stated as such: a copying
   * garbage collector may already have moved these bytes, and JavaScript gives
   * no way to know. It costs one line and removes the copy we can reach.
   */
  raw.fill(0);

  return {
    package: {
      version,
      kdf: KDF,
      salt: toBase64(salt),
      iv: toBase64(iv),
      package: toBase64(new Uint8Array(sealed)),
    },
    publicKey: toBase64(new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey))),
    privateKey,
  };
}

/** Thrown when a package will not open. The reason matters to the UI. */
export class RecoveryError extends Error {
  constructor(
    message: string,
    readonly code: 'bad-code' | 'unsupported-kdf' | 'rolled-back',
  ) {
    super(message);
    this.name = 'RecoveryError';
  }
}

/**
 * Opens a package and returns the recovery key, non-extractable.
 *
 * `seenVersion` is the rollback defence. A server cannot forge a package - it
 * has no code to encrypt one under, and GCM refuses anything it did not
 * produce - but it can replay a package the user has already superseded, and
 * strand them on a key they rotated away from. Refusing a version this device
 * has already passed closes that, and costs one integer.
 */
export async function restoreRecoveryKey(
  stored: RecoveryPackage,
  code: string,
  seenVersion = 0,
): Promise<CryptoKey> {
  if (stored.kdf !== KDF) {
    throw new RecoveryError(
      'This recovery package was made by a newer version of PINGO.',
      'unsupported-kdf',
    );
  }

  if (stored.version < seenVersion) {
    throw new RecoveryError(
      'This recovery package is out of date. Someone may be replaying an old one.',
      'rolled-back',
    );
  }

  const key = await wrappingKey(code, fromBase64(stored.salt));

  let raw: ArrayBuffer;
  try {
    raw = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(stored.iv) },
      key,
      fromBase64(stored.package),
    );
  } catch {
    /*
     * One message for a wrong code and for a tampered package, on purpose.
     * Telling them apart would tell an attacker which of the two they got
     * right, and the user's action is the same either way: check the code.
     */
    throw new RecoveryError('That recovery code did not work.', 'bad-code');
  }

  return crypto.subtle.importKey('pkcs8', raw, { name: 'ECDH', namedCurve: 'P-256' }, false, [
    'deriveKey',
    'deriveBits',
  ]);
}
