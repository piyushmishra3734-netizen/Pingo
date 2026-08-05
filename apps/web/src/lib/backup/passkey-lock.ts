/**
 * What stands between somebody else and your history.
 *
 * The twelve-word code is gone. Nobody writes one down, and a backup that
 * cannot be opened by the person who made it is not a backup. What replaces it
 * is the thing people already use to unlock the device in their hand:
 *
 *   - **a passkey** — Face ID, Touch ID, Windows Hello, the Android screen
 *     lock — through WebAuthn's PRF extension, or
 *   - **a passcode they chose** — a password, a PIN, or a pattern.
 *
 * Until one of them verifies, nothing is recovered. That is not a policy check
 * in the client: the archive key is *sealed* to the secret, so a device without
 * it holds ciphertext and nothing else. PINGO cannot open it either, which is
 * the constraint this whole subsystem exists to keep.
 *
 * ## Two sources, one envelope
 *
 * Both paths produce the same `Lock`, tagged with how it was made, so restore
 * asks for whichever the account has and everything downstream is identical. A
 * passkey's PRF output is already 32 uniform bytes, so it goes through HKDF; a
 * passcode is low entropy and human-chosen, so it goes through PBKDF2 with a
 * deliberately painful iteration count. Naming the KDF in the stored envelope
 * is what lets Argon2id arrive later without orphaning anybody.
 *
 * ## Changing it never re-encrypts anything
 *
 * A change unwraps the same key pair and re-wraps it under the new secret. The
 * archive, and every message already sealed to that key, is untouched — which
 * is what makes "change my passkey" a two-second operation on a phone rather
 * than a re-upload of somebody's entire history.
 *
 * ## A pattern is a passcode
 *
 * Nine dots, joined in an order: serialise the order and it is a short string.
 * It is treated exactly like a PIN, including the same warning about how few
 * of them there are — see `passcodeStrength`.
 */

const PBKDF2_ITERATIONS = 600_000;

/** Named in the envelope so a future KDF can be added without a migration. */
export const PASSCODE_KDF = 'pbkdf2-sha256-600000';
export const PASSKEY_KDF = 'hkdf-sha256-prf';

export type LockMethod = 'passcode' | 'passkey';

/** What a passcode is made of. A pattern is serialised into `pattern`. */
export type PasscodeKind = 'password' | 'pin' | 'pattern';

export interface Lock {
  /** How the secret was obtained. Restore uses this to know what to ask for. */
  method: LockMethod;
  /** Which sort of passcode, for the prompt. Absent on passkeys. */
  passcodeKind?: PasscodeKind;
  kdf: string;
  /** Base64. Random per lock, and never reused when the secret changes. */
  salt: string;
  iv: string;
  /** Base64 of the sealed PKCS8 private key. */
  sealed: string;
  /**
   * SPKI, base64 — the half archives are sealed *to*.
   *
   * Stored in the open beside the sealed half, because it is public by
   * definition and because the alternative is worse: `openLock` returns a
   * non-extractable key, so a caller that needed the public half would have to
   * keep an extractable copy of the private one to derive it from.
   */
  publicKey: string;
  /** The credential to ask for, on the passkey path. */
  credentialId?: string;
  /**
   * Bumped on every change.
   *
   * A server cannot forge one of these — it has no secret to seal with, and
   * GCM refuses anything it did not produce — but it can hand back a copy the
   * user has already replaced, stranding them on a secret they changed away
   * from. A device that has seen version 3 refuses version 2.
   */
  version: number;
}

export class LockError extends Error {
  constructor(
    message: string,
    readonly code: 'wrong-secret' | 'unsupported-kdf' | 'rolled-back' | 'no-passkey',
  ) {
    super(message);
    this.name = 'LockError';
  }
}

const toBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const fromBase64 = (value: string): Uint8Array => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

/**
 * A passcode is taken exactly as typed.
 *
 * No trimming, no lowercasing. The recovery *code* was normalised because
 * twelve dictionary words survive it and people paste them with stray
 * whitespace — but a password whose capitals are quietly discarded is a
 * password its owner cannot reason about, and a leading space somebody meant
 * to type is theirs to keep.
 */
async function passcodeKey(passcode: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passcode),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * A passkey's PRF output is already uniform, so it is stretched rather than
 * hardened. Running PBKDF2 over 32 random bytes would cost half a second to
 * add nothing at all.
 */
async function passkeyKey(prf: Uint8Array, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', prf as BufferSource, 'HKDF', false, [
    'deriveKey',
  ]);

  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: salt as BufferSource,
      info: new TextEncoder().encode('pingo/backup-lock/v1'),
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

const wrappingKey = (
  method: LockMethod,
  secret: string | Uint8Array,
  salt: Uint8Array,
): Promise<CryptoKey> =>
  method === 'passcode'
    ? passcodeKey(secret as string, salt)
    : passkeyKey(secret as Uint8Array, salt);

/**
 * Seals a fresh recovery key pair under the secret.
 *
 * The private half is extractable for exactly four statements — long enough to
 * seal it, short enough that nothing remote happens in between — and comes back
 * non-extractable. Do not put an `await` on anything network-bound inside that
 * window.
 */
export async function createLock(input: {
  method: LockMethod;
  secret: string | Uint8Array;
  passcodeKind?: PasscodeKind;
  credentialId?: string;
  version?: number;
}): Promise<{ lock: Lock; publicKey: string; privateKey: CryptoKey }> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveKey',
    'deriveBits',
  ]);

  const raw = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const key = await wrappingKey(input.method, input.secret, salt);
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, raw as BufferSource);

  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    raw.buffer as ArrayBuffer,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveKey', 'deriveBits'],
  );

  const publicKey = toBase64(new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey)));

  // Best effort, and stated as such: a copying collector may already have moved
  // these bytes. It costs one line and clears the copy this code can reach.
  raw.fill(0);

  return {
    lock: {
      method: input.method,
      ...(input.passcodeKind ? { passcodeKind: input.passcodeKind } : {}),
      kdf: input.method === 'passcode' ? PASSCODE_KDF : PASSKEY_KDF,
      salt: toBase64(salt),
      iv: toBase64(iv),
      sealed: toBase64(new Uint8Array(sealed)),
      publicKey,
      ...(input.credentialId ? { credentialId: input.credentialId } : {}),
      version: input.version ?? 1,
    },
    publicKey,
    privateKey,
  };
}

/**
 * Seals a key pair that already exists.
 *
 * This is the one that matters when a lock is added to an account that has
 * already been backing up. `createLock` mints a *new* pair, and locking with
 * a new pair orphans every archive on Drive — they were sealed to the old one,
 * and the first chunk simply will not open. That is not a theory: it was
 * reported as "backup part 0 could not be opened" within an hour of the lock
 * shipping.
 *
 * So: same key, new protection. Nothing is re-uploaded and nothing stops
 * opening.
 */
export async function lockExistingKey(input: {
  /** PKCS8 bytes of the key the archives are already sealed to. */
  privateKeyPkcs8: Uint8Array;
  /** SPKI, base64 — its public half, unchanged. */
  publicKey: string;
  method: LockMethod;
  secret: string | Uint8Array;
  passcodeKind?: PasscodeKind;
  credentialId?: string;
  version?: number;
}): Promise<Lock> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await wrappingKey(input.method, input.secret, salt);
  const sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    input.privateKeyPkcs8 as BufferSource,
  );

  return {
    method: input.method,
    ...(input.passcodeKind ? { passcodeKind: input.passcodeKind } : {}),
    kdf: input.method === 'passcode' ? PASSCODE_KDF : PASSKEY_KDF,
    salt: toBase64(salt),
    iv: toBase64(iv),
    sealed: toBase64(new Uint8Array(sealed)),
    publicKey: input.publicKey,
    ...(input.credentialId ? { credentialId: input.credentialId } : {}),
    version: input.version ?? 1,
  };
}

/**
 * Opens a lock, or refuses.
 *
 * `seenVersion` is the rollback defence: a version this device has already
 * passed is a replay of a secret the user has changed away from.
 */
export async function openLock(
  lock: Lock,
  secret: string | Uint8Array,
  seenVersion = 0,
): Promise<CryptoKey> {
  if (lock.version < seenVersion) {
    throw new LockError('This backup lock is older than the one this device has seen.', 'rolled-back');
  }

  const expected = lock.method === 'passcode' ? PASSCODE_KDF : PASSKEY_KDF;
  if (lock.kdf !== expected) {
    throw new LockError(`This app cannot open a ${lock.kdf} lock.`, 'unsupported-kdf');
  }

  const key = await wrappingKey(lock.method, secret, fromBase64(lock.salt));

  let raw: ArrayBuffer;
  try {
    raw = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(lock.iv) as BufferSource },
      key,
      fromBase64(lock.sealed) as BufferSource,
    );
  } catch {
    /*
     * GCM failing is the only signal, and it is the right one: a wrong
     * passcode and a tampered package are indistinguishable from here, and
     * both mean "this did not open".
     */
    throw new LockError('That did not unlock your backup.', 'wrong-secret');
  }

  return crypto.subtle.importKey('pkcs8', raw, { name: 'ECDH', namedCurve: 'P-256' }, false, [
    'deriveKey',
    'deriveBits',
  ]);
}

/**
 * Swaps the secret without touching the archive.
 *
 * The same key pair comes out the other side, so nothing that was ever sealed
 * to it stops opening. The salt and IV are fresh — reusing them under a new
 * secret would leak that the two locks protect the same key — and the version
 * goes up so the old envelope cannot be replayed.
 */
export async function changeLock(input: {
  lock: Lock;
  current: string | Uint8Array;
  next: { method: LockMethod; secret: string | Uint8Array; passcodeKind?: PasscodeKind; credentialId?: string };
}): Promise<Lock> {
  const privateKey = await openLock(input.lock, input.current);

  /*
   * Re-exporting needs an extractable key, and `openLock` deliberately returns
   * one that is not. So the bytes are taken from the old envelope directly —
   * they are already in hand, already verified by GCM, and never leave this
   * function.
   */
  void privateKey;

  const key = await wrappingKey(input.lock.method, input.current, fromBase64(input.lock.salt));
  const raw = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(input.lock.iv) as BufferSource },
      key,
      fromBase64(input.lock.sealed) as BufferSource,
    ),
  );

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const nextKey = await wrappingKey(input.next.method, input.next.secret, salt);
  const sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    nextKey,
    raw as BufferSource,
  );
  raw.fill(0);

  return {
    method: input.next.method,
    ...(input.next.passcodeKind ? { passcodeKind: input.next.passcodeKind } : {}),
    kdf: input.next.method === 'passcode' ? PASSCODE_KDF : PASSKEY_KDF,
    salt: toBase64(salt),
    iv: toBase64(iv),
    sealed: toBase64(new Uint8Array(sealed)),
    // The key pair did not change, so neither does its public half.
    publicKey: input.lock.publicKey,
    ...(input.next.credentialId ? { credentialId: input.next.credentialId } : {}),
    version: input.lock.version + 1,
  };
}

export type PasscodeVerdict = 'too-short' | 'weak' | 'fine';

/**
 * How much a chosen passcode is worth, said plainly.
 *
 * Not a meter with colours. There are ten thousand four-digit PINs and about
 * four hundred thousand plausible patterns, so both are guessable by anyone
 * holding the file — and the honest thing is to say which of the three they
 * picked rather than to imply a PIN can be made strong by adding a digit.
 */
export function passcodeStrength(passcode: string, kind: PasscodeKind): PasscodeVerdict {
  const value = passcode.trim();
  if (kind === 'pin') return value.length < 4 ? 'too-short' : value.length < 6 ? 'weak' : 'fine';
  if (kind === 'pattern') return value.length < 4 ? 'too-short' : value.length < 6 ? 'weak' : 'fine';
  if (value.length < 8) return 'too-short';
  const variety = [/[a-z]/u, /[A-Z]/u, /\d/u, /[^\w]/u].filter((re) => re.test(value)).length;
  return variety < 2 || value.length < 12 ? 'weak' : 'fine';
}
