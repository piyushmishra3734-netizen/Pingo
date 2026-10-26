/**
 * The cryptography of a private chat, and nothing else.
 *
 * Each person makes a temporary key pair when the session starts. Their public
 * halves are swapped through the server; each phone combines its own private key
 * with the other's public key and gets the same secret, which becomes one AES key
 * for the whole session. Every message is encrypted under it, so the server holds
 * ciphertext it cannot open.
 *
 * Small on purpose. The earlier design wrapped a key per device per message and
 * paid for it in size and time; here a message costs one AES-GCM operation and
 * carries 28 bytes of overhead (a 12 byte nonce and a 16 byte tag).
 *
 * Web Crypto only, so it is the same code on the web and inside the Android
 * WebView, and a test can run it in Node.
 */

const CURVE = { name: 'ECDH', namedCurve: 'P-256' } as const;
const enc = new TextEncoder();
const dec = new TextDecoder();

/** What goes inside a sealed message. A type field leaves room for files and voice later. */
export type PrivateBody = { t: 'text'; b: string };

export function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x2000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x2000));
  }
  return btoa(s);
}

export function fromB64(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i);
  return out;
}

/**
 * A fresh key pair for one session. The private half cannot be exported, even by
 * this code; it can only be used (and stored by the browser as an opaque handle).
 */
export async function newKeyPair(): Promise<{ pair: CryptoKeyPair; pub: string }> {
  const pair = await crypto.subtle.generateKey(CURVE, false, ['deriveBits']);
  const pub = toB64(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
  return { pair, pub };
}

/** The session's AES key, from my private key and the other person's public key. */
export async function deriveSessionKey(mine: CryptoKey, theirPub: string, sessionId: string): Promise<CryptoKey> {
  const theirs = await crypto.subtle.importKey('raw', fromB64(theirPub) as BufferSource, CURVE, false, []);
  const secret = await crypto.subtle.deriveBits({ name: 'ECDH', public: theirs }, mine, 256);
  const base = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode(sessionId), info: enc.encode('pingo-private-v1') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Who sent it and in which session are authenticated too: a copied message will not open elsewhere. */
const bind = (sessionId: string, senderId: string) => enc.encode(`${sessionId}|${senderId}`);

export async function seal(key: CryptoKey, sessionId: string, senderId: string, body: PrivateBody): Promise<string> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce, additionalData: bind(sessionId, senderId) as BufferSource },
      key,
      enc.encode(JSON.stringify(body)),
    ),
  );
  const out = new Uint8Array(nonce.length + ct.length);
  out.set(nonce);
  out.set(ct, nonce.length);
  return toB64(out);
}

/** `null` for anything that does not open: wrong key, wrong session, wrong sender, or altered. */
export async function open(key: CryptoKey, sessionId: string, senderId: string, sealed: string): Promise<PrivateBody | null> {
  try {
    const bytes = fromB64(sealed);
    if (bytes.length < 12 + 16) return null;
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.subarray(0, 12) as BufferSource, additionalData: bind(sessionId, senderId) as BufferSource },
      key,
      bytes.subarray(12) as BufferSource,
    );
    const body = JSON.parse(dec.decode(plain)) as PrivateBody;
    return body && body.t === 'text' && typeof body.b === 'string' ? body : null;
  } catch {
    return null;
  }
}
