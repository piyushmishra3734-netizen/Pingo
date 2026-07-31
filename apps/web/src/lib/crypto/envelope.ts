import { fromBase64, importPublicKey, toBase64 } from './keys.js';

/**
 * Encrypting one message for a set of devices.
 *
 * The construction, once, in one place:
 *
 * 1. A fresh AES-256-GCM **content key** encrypts the body.
 * 2. A fresh **ephemeral keypair** is generated.
 * 3. For each recipient device, ECDH(ephemeral, theirPublic) → HKDF → a
 *    key-encryption key, which wraps the content key.
 * 4. The ciphertext, the ephemeral public key and the wraps travel together.
 *
 * Fresh both times, and for different reasons. A reused content key means one
 * compromise reads every message; a reused ephemeral means the same ECDH secret
 * repeats, and identical wraps across messages become a way to link them.
 *
 * The HKDF step is not optional. Raw ECDH output is a point on a curve, not a
 * uniform key, and feeding it straight into AES is the classic mistake in
 * hand-rolled protocols - it usually works, which is why it survives review.
 */

/** Bound into HKDF so a key derived here cannot be replayed into another use. */
const KDF_INFO = new TextEncoder().encode('pingo/v1/message-key-wrap');

export interface Envelope {
  /** SPKI base64. The other half of every ECDH below. */
  epk: string;
  /** Nonce for the body's own AES-GCM. */
  iv: string;
  /** One wrapped content key per recipient device, keyed by device id. */
  keys: Record<string, { iv: string; key: string }>;
}

export interface Encrypted {
  /** Base64 ciphertext. What the server stores in `body`. */
  body: string;
  envelope: Envelope;
}

/** A recipient device: who to wrap for, and the key to wrap against. */
export interface RecipientDevice {
  deviceId: string;
  publicKey: string;
}

async function wrapKeyFor(
  ephemeral: CryptoKeyPair,
  device: RecipientDevice,
  contentKey: CryptoKey,
): Promise<{ iv: string; key: string }> {
  const theirs = await importPublicKey(device.publicKey);

  /*
   * ECDH gives shared bits; HKDF turns them into a key. `deriveBits` then a
   * separate import is deliberate - `deriveKey` straight to AES-GCM would skip
   * the HKDF step and derive the wrapping key directly from the curve output.
   */
  const shared = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: theirs },
    ephemeral.privateKey,
    256,
  );

  const hkdfKey = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);

  const wrappingKey = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      // Empty salt is correct here: the ephemeral key already makes every
      // derivation unique, which is the job a salt would otherwise do.
      salt: new Uint8Array(0),
      info: KDF_INFO,
    },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );

  /*
   * The content key has to be extractable to be wrapped - its bytes are what
   * gets encrypted. That is safe because those bytes only ever exist inside
   * this function and end up encrypted before they leave it. The *identity* and
   * *database* keys, which are long-lived, are not extractable.
   */
  const raw = await crypto.subtle.exportKey('raw', contentKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrappingKey, raw);

  return { iv: toBase64(iv), key: toBase64(new Uint8Array(wrapped)) };
}

export async function encryptMessage(
  plaintext: string,
  devices: RecipientDevice[],
): Promise<Encrypted> {
  if (devices.length === 0) {
    /*
     * Refused rather than sent in the clear.
     *
     * Nobody has published a key yet, so there is no one to encrypt to. Falling
     * back to plaintext would be the single worst failure this system can have:
     * silent, invisible, and indistinguishable from working. The caller decides
     * what to do - currently, send as legacy, which is at least honest about
     * what it is.
     */
    throw new Error('No recipient devices to encrypt for.');
  }

  const contentKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ]);

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    contentKey,
    new TextEncoder().encode(plaintext),
  );

  const ephemeral = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, [
    'deriveBits',
  ]);

  const keys: Envelope['keys'] = {};
  await Promise.all(
    devices.map(async (device) => {
      keys[device.deviceId] = await wrapKeyFor(ephemeral, device, contentKey);
    }),
  );

  return {
    body: toBase64(new Uint8Array(ciphertext)),
    envelope: {
      epk: await crypto.subtle
        .exportKey('spki', ephemeral.publicKey)
        .then((spki) => toBase64(new Uint8Array(spki))),
      iv: toBase64(iv),
      keys,
    },
  };
}

/**
 * Reads a message this device was a recipient of.
 *
 * Returns `undefined` rather than throwing when the envelope holds no wrap for
 * this device - that is not an error, it is a message sent before this device
 * existed, and the difference matters to what the UI shows. A thrown error
 * would become a broken bubble; a known absence becomes a sentence.
 */
export async function decryptMessage(
  body: string,
  envelope: Envelope,
  deviceId: string,
  identity: CryptoKeyPair,
): Promise<string | undefined> {
  const wrap = envelope.keys[deviceId];
  if (!wrap) return undefined;

  const ephemeralPublic = await importPublicKey(envelope.epk);

  const shared = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: ephemeralPublic },
    identity.privateKey,
    256,
  );

  const hkdfKey = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);

  const wrappingKey = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: KDF_INFO },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );

  const rawContentKey = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(wrap.iv) },
    wrappingKey,
    fromBase64(wrap.key),
  );

  const contentKey = await crypto.subtle.importKey(
    'raw',
    rawContentKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(envelope.iv) },
    contentKey,
    fromBase64(body),
  );

  return new TextDecoder().decode(plaintext);
}
