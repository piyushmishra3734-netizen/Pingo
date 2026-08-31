import { STORE, localGet, localSet } from '../local/db.js';

/**
 * This device's keys, and where they live.
 *
 * Two of them, doing different jobs:
 *
 * - the **identity keypair** (ECDH P-256) is how other people encrypt to this
 *   device, and its public half is published;
 * - the **database key** (AES-256-GCM) encrypts what this device caches on
 *   disk, and is published nowhere and known to nothing else.
 *
 * ## Non-extractable, which is the whole guarantee
 *
 * Both are created with `extractable: false`. The browser will perform
 * operations with them and `exportKey` throws - so no bug, no XSS, no
 * well-meaning future line can serialise a private key into a request, a log or
 * a sync payload. The promise is kept by the platform rather than by our care,
 * which is the only way a promise like that survives a codebase growing.
 *
 * A `CryptoKey` is a structured-clonable handle, so IndexedDB stores the handle
 * and the browser keeps the material. Nothing here ever holds key bytes.
 *
 * ## What non-extractable does not mean
 *
 * Code running inside PINGO's own origin can still *use* these keys, because
 * using them is what they are for. Non-extractable means they cannot be stolen,
 * not that they cannot be exercised. No browser design escapes that, and any
 * claim otherwise is marketing.
 */

/** Named so a rotation can add `identity:v2` beside it rather than replace it. */
const IDENTITY = 'identity:v1';
const DATABASE = 'database:v1';
const DEVICE_ID = 'device-id';

/** ECDH over P-256. See the architecture note on why not X25519. */
const IDENTITY_ALGORITHM: EcKeyGenParams = { name: 'ECDH', namedCurve: 'P-256' };

export interface DeviceIdentity {
  deviceId: string;
  keyPair: CryptoKeyPair;
  /** SPKI, base64. What gets published and what senders wrap against. */
  publicKey: string;
}

/**
 * A note in a second place that this device has an identity.
 *
 * `localGet` cannot tell "there is no such key" from "the database would not
 * open" - `withStore` resolves `undefined` for a missing record, a failed
 * transaction, and a database that never opened at all. `deviceIdentity` read
 * that `undefined` and minted a fresh keypair, which orphans every message ever
 * wrapped for the old one. On screen that is "Sent before you added this
 * device." appearing over a conversation somebody has been reading for weeks,
 * with nothing having changed - which is exactly how it was reported.
 *
 * IndexedDB is also evicted wholesale under storage pressure, and an evicted
 * database opens perfectly and is simply empty, so no amount of care inside
 * IndexedDB can catch that case. This mirror lives in `localStorage` instead:
 * different store, different eviction, one string. If it says an identity
 * existed and IndexedDB has none, the keys are missing rather than absent, and
 * minting would destroy history rather than begin it.
 *
 * Parked and restored by `switchAccount` alongside the keys themselves - a
 * second account signing in on this device genuinely has no identity yet, and
 * must still be allowed to make one.
 */
export const IDENTITY_MIRROR = 'pingo:identity-exists';

function readMirror(): string | null {
  try {
    return localStorage.getItem(IDENTITY_MIRROR);
  } catch {
    return null;
  }
}

function writeMirror(deviceId: string): void {
  try {
    localStorage.setItem(IDENTITY_MIRROR, deviceId);
  } catch {
    /*
     * No mirror is the old behaviour, not a new failure: it only means this
     * device cannot detect the eviction case. Refusing to work at all because
     * the safety net is unavailable would be worse than the thing it catches.
     */
  }
}

/**
 * The device's identity, created on first call and reused forever after.
 *
 * Generating a second one would orphan every message already wrapped for the
 * first, so this is deliberately load-then-create rather than create-then-store:
 * a race between two tabs on first run must not produce two identities.
 *
 * And "forever after" is now enforced rather than hoped for - see the mirror
 * above. Minting happens only when this device can be shown never to have had
 * an identity; every other shape of missing is a failure to read one.
 */
export async function deviceIdentity(): Promise<DeviceIdentity> {
  const existing = await localGet<CryptoKeyPair>(STORE.keys, IDENTITY);
  const existingId = await localGet<string>(STORE.keys, DEVICE_ID);

  if (existing && existingId) {
    // Cheap, and it repairs a mirror lost on its own - localStorage can be
    // cleared without IndexedDB going with it.
    if (readMirror() !== existingId) writeMirror(existingId);
    return {
      deviceId: existingId,
      keyPair: existing,
      publicKey: await exportPublicKey(existing.publicKey),
    };
  }

  /*
   * Reported, and then repaired. It used to throw here, and that was worse than
   * the bug it was guarding against.
   *
   * The reasoning was sound: a device that once had keys and now cannot read
   * them has *lost* them, and minting a second identity orphans every message
   * ever wrapped for the first. So it refused.
   *
   * What that missed is where the refusal lands. `openRow` catches everything
   * and writes the "Sent before you added this device" placeholder, so a device
   * that refused to mint could not read a single message - not the history it
   * was protecting, and not the one that arrived a second ago either. Every
   * account except the one machine that happened to have both slots went dark
   * within hours, and no device published a key for six of them, which is what
   * a refusal looks like from the database.
   *
   * A wrong identity loses old messages. No identity loses all of them, plus
   * every future one. So it mints, says so loudly, and the mirror stays as the
   * evidence rather than as a gate - the guard is worth having only if it can
   * be made to fail in the direction that keeps the app usable.
   */
  const mirrored = readMirror();
  if (existing || existingId || mirrored) {
    console.warn(
      'pingo: device keys were unreadable, minting a replacement.',
      existing || existingId
        ? 'Half the identity was missing.'
        : `The store is empty but ${mirrored?.slice(0, 8)}… was minted here.`,
    );
  }

  const keyPair = await crypto.subtle.generateKey(IDENTITY_ALGORITHM, false, [
    'deriveKey',
    'deriveBits',
  ]);

  const deviceId = crypto.randomUUID();

  await localSet(STORE.keys, IDENTITY, keyPair);
  await localSet(STORE.keys, DEVICE_ID, deviceId);
  writeMirror(deviceId);

  return { deviceId, keyPair, publicKey: await exportPublicKey(keyPair.publicKey) };
}

/**
 * The key that encrypts this device's local cache.
 *
 * Generated rather than derived from a password, and that is a decision with a
 * cost: a passphrase-derived key would also protect a device that is merely
 * locked. But it would mean a prompt on every cold start, and PINGO has
 * accounts with no password at all - signing in with Google never creates one.
 * A design that cannot serve its own Google users is not a design.
 *
 * See the roadmap: a passphrase-locked vault is a feature, for people who want
 * it, rather than a tax on everybody.
 */
export async function databaseKey(): Promise<CryptoKey> {
  const existing = await localGet<CryptoKey>(STORE.keys, DATABASE);
  if (existing) return existing;

  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);

  await localSet(STORE.keys, DATABASE, key);
  return key;
}

/** SPKI base64 - the wire form of a public key, in both directions. */
export async function exportPublicKey(key: CryptoKey): Promise<string> {
  const spki = await crypto.subtle.exportKey('spki', key);
  return toBase64(new Uint8Array(spki));
}

export async function importPublicKey(base64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'spki',
    fromBase64(base64),
    IDENTITY_ALGORITHM,
    true,
    [],
  );
}

/**
 * A fingerprint somebody can read aloud.
 *
 * Not used yet - device verification is a later step - but derived here so the
 * definition lives beside the key it describes rather than being invented twice
 * by two screens that then disagree about what a fingerprint is.
 */
export async function fingerprint(publicKeyBase64: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', fromBase64(publicKeyBase64));
  return [...new Uint8Array(digest).slice(0, 10)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .replace(/(.{4})/g, '$1 ')
    .trim()
    .toUpperCase();
}

// -- base64, on bytes ------------------------------------------------------
//
// `btoa` works on a string of char codes, so anything above 0xFF throws. Going
// through a byte array is the only form that survives arbitrary ciphertext,
// which is exactly what is being encoded here.

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  // Chunked: spreading a large array into `fromCharCode` overflows the stack
  // somewhere around a hundred thousand bytes, and media will exceed that.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/*
 * Returns a fresh ArrayBuffer rather than a view.
 *
 * Web Crypto takes a BufferSource, and TypeScript 5.7 made Uint8Array generic
 * over its backing buffer -- so a plain view no longer satisfies the parameter
 * and every call site would need a cast. Handing back the buffer itself is both
 * type-correct and one fewer indirection for the crypto to walk.
 */
export function fromBase64(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
