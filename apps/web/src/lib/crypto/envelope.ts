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
  /**
   * One wrapped content key per recipient device, keyed by device id.
   *
   * `epk` is per-wrap and almost always absent. A wrap written at send time
   * shares the envelope's single ephemeral, because one ephemeral wrapped for
   * every recipient at once. A wrap *added later* cannot: the ephemeral
   * private half was discarded the moment the message was sealed, so a
   * late-added wrap brings its own ephemeral and says so here.
   *
   * Absent therefore means "use the envelope's", which is what every wrap
   * written before this field existed meant, and still means.
   */
  keys: Record<string, { iv: string; key: string; epk?: string }>;
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

/**
 * One ECDH, one HKDF, one wrapping key - the only place either is done.
 *
 * `deriveBits` then a separate import is deliberate: `deriveKey` straight to
 * AES-GCM would skip the HKDF step and derive the wrapping key directly from
 * the curve output, which is the classic hand-rolled-protocol mistake.
 */
async function wrappingKey(
  ours: CryptoKey,
  theirPublicKey: string,
  usage: 'encrypt' | 'decrypt',
): Promise<CryptoKey> {
  const theirs = await importPublicKey(theirPublicKey);
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: theirs }, ours, 256);
  const hkdfKey = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);

  return crypto.subtle.deriveKey(
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
    [usage],
  );
}

/** The content key's raw bytes, from whichever ephemeral this wrap was made to. */
async function unwrapContentKey(
  wrap: Envelope['keys'][string],
  envelopeEpk: string,
  ours: CryptoKey,
): Promise<ArrayBuffer> {
  // A wrap added after the fact carries its own ephemeral; one written at send
  // time shares the envelope's. See the `keys` doc above.
  const kek = await wrappingKey(ours, wrap.epk ?? envelopeEpk, 'decrypt');

  return crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(wrap.iv) },
    kek,
    fromBase64(wrap.key),
  );
}

/** Wrap raw content-key bytes to one public key, under a fresh ephemeral. */
async function wrapRawFor(
  raw: ArrayBuffer,
  ephemeral: CryptoKeyPair,
  publicKey: string,
): Promise<{ iv: string; key: string }> {
  const kek = await wrappingKey(ephemeral.privateKey, publicKey, 'encrypt');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek, raw);

  return { iv: toBase64(iv), key: toBase64(new Uint8Array(wrapped)) };
}

async function wrapKeyFor(
  ephemeral: CryptoKeyPair,
  device: RecipientDevice,
  contentKey: CryptoKey,
): Promise<{ iv: string; key: string }> {
  /*
   * The content key has to be extractable to be wrapped - its bytes are what
   * gets encrypted. That is safe because those bytes only ever exist inside
   * this function and end up encrypted before they leave it. The *identity* and
   * *database* keys, which are long-lived, are not extractable.
   */
  return wrapRawFor(await crypto.subtle.exportKey('raw', contentKey), ephemeral, device.publicKey);
}

/**
 * A wrap this envelope does not have yet, made from one it does.
 *
 * The point of the whole backfill, and the reason it can be done at all: a
 * message is readable by anyone holding *a* wrap, and a new wrap for the same
 * content key opens the same ciphertext. So history reaches a key it was never
 * sent to without the body being touched, re-encrypted, or even decrypted -
 * this never sees the plaintext, only the content key that would open it.
 *
 * The content key's bytes do not leave this function. What comes back is
 * already encrypted to `toPublicKey`, and is the only thing the caller can
 * send anywhere.
 *
 * Takes the one wrap rather than the whole envelope, because the whole
 * envelope is 3.7 kB of other people's wraps that this has no use for - and a
 * backfill that fetched them would move 131 MB to do 10 MB of work.
 */
/**
 * True when this private key is the other half of this public key.
 *
 * Cheap insurance for a backfill. Wrapping to the wrong public key is silent -
 * every wrap succeeds, and the failure only shows up on the device that later
 * cannot open any of them. So the pair is tested once, on a throwaway value,
 * before thirty-six thousand wraps are made on the strength of it.
 *
 * A round trip is the only honest test here: ECDH gives no way to derive the
 * public half from a non-extractable private key and compare.
 */
export async function keysArePair(ours: CryptoKey, publicKey: string): Promise<boolean> {
  try {
    const probe = crypto.getRandomValues(new Uint8Array(32));

    const ephemeral = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      ['deriveBits'],
    );

    const wrap = await wrapRawFor(probe.buffer, ephemeral, publicKey);
    const epk = toBase64(new Uint8Array(await crypto.subtle.exportKey('spki', ephemeral.publicKey)));

    const back = new Uint8Array(await unwrapContentKey(wrap, epk, ours));
    return back.length === probe.length && back.every((byte, i) => byte === probe[i]);
  } catch {
    return false;
  }
}

export async function rewrapContentKey(
  wrap: Envelope['keys'][string],
  envelopeEpk: string,
  ours: CryptoKey,
  toPublicKey: string,
): Promise<{ iv: string; key: string; epk: string }> {
  const raw = await unwrapContentKey(wrap, envelopeEpk, ours);

  // Fresh, as at send time. Reusing one across a backfill would repeat the
  // same ECDH secret for every message, which is exactly what the ephemeral
  // exists to prevent.
  const ephemeral = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, [
    'deriveBits',
  ]);

  return {
    ...(await wrapRawFor(raw, ephemeral, toPublicKey)),
    epk: toBase64(new Uint8Array(await crypto.subtle.exportKey('spki', ephemeral.publicKey))),
  };
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
  /*
   * The private half is all this needs, and saying so is what lets the account
   * key be passed here. It is unwrapped from a stored package rather than
   * generated as a pair, so there is no public half to hand over - and
   * requiring one would have meant either re-deriving it or inventing a
   * placeholder, both of which are worse than narrowing the type.
   */
  identity: Pick<CryptoKeyPair, 'privateKey'>,
): Promise<string | undefined> {
  const wrap = envelope.keys[deviceId];
  if (!wrap) return undefined;

  const rawContentKey = await unwrapContentKey(wrap, envelope.epk, identity.privateKey);

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
