/**
 * Simple Backup's key: the one Google holds.
 *
 * Mode 1 of `effortless-backup-plan.md` §10. The archive is sealed to a keypair
 * whose private half lives in the user's own Drive `appDataFolder`, beside the
 * archive it opens. Anyone who can sign into that Google account can restore,
 * which is exactly what makes restore automatic and is the whole trade.
 *
 * ## What this is not
 *
 * It is not the recovery key, and it must never become it. §9 of the plan is
 * explicit: putting the *recovery* private key in Drive would hand Google the
 * key that also unwraps live message envelopes, and that is a different and much
 * larger giveaway than the archive. So Simple mode gets its own keypair, used
 * for archives and nothing else, and `verify:key-isolation` exists to keep the
 * two apart.
 *
 * ## What the interface must say
 *
 * "Google can access this backup. Anyone who can sign in to your Google account
 * can read these chats." Not "secured by Google", not "encrypted in Drive". If
 * that sentence is uncomfortable, the honest answer is Private mode, not softer
 * wording.
 *
 * PINGO still cannot read anything: the key is generated on the device and goes
 * straight to the user's Drive. It never reaches our server.
 */

/** Where the private half lives, next to the archive it opens. */
export const ARCHIVE_KEY_FILE = 'pingo.archivekey.json';

/** The minimum of a Drive client this needs. Injected so it can be tested. */
export interface ArchiveKeyStore {
  find(name: string): Promise<{ id: string } | undefined>;
  upload(name: string, bytes: Uint8Array): Promise<unknown>;
  download(id: string): Promise<Uint8Array>;
}

export interface ArchiveKeyPair {
  /** SPKI, base64. What archives and receipts are sealed to. */
  publicKey: string;
  /** The half that opens them. Extractable by design — Drive must hold it. */
  privateKey: CryptoKey;
}

interface StoredArchiveKey {
  version: 1;
  /** PKCS8, base64. */
  privateKey: string;
  /** SPKI, base64. */
  publicKey: string;
  createdAt: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const toBase64 = (bytes: Uint8Array) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const fromBase64 = (text: string) => {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
};

export class ArchiveKeyError extends Error {
  constructor(
    message: string,
    readonly code: 'missing' | 'unreadable' | 'unsupported',
  ) {
    super(message);
    this.name = 'ArchiveKeyError';
  }
}

async function importPrivate(pkcs8: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'pkcs8',
    fromBase64(pkcs8) as unknown as ArrayBuffer,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits', 'deriveKey'],
  );
}

/**
 * The archive key for this account, generated once and reused after.
 *
 * Read before write: a second device must find the key the first one made,
 * because two archive keys would mean the newest archive could not be opened by
 * whichever half the other device holds.
 */
export async function ensureArchiveKey(drive: ArchiveKeyStore): Promise<ArchiveKeyPair> {
  const existing = await loadArchiveKey(drive).catch((cause) => {
    // A key that exists but will not parse must not be silently replaced —
    // overwriting it would orphan every archive already sealed to it.
    if (cause instanceof ArchiveKeyError && cause.code === 'missing') return undefined;
    throw cause;
  });
  if (existing) return existing;

  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
    'deriveKey',
  ]);

  const stored: StoredArchiveKey = {
    version: 1,
    privateKey: toBase64(new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey))),
    publicKey: toBase64(new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey))),
    createdAt: Date.now(),
  };

  await drive.upload(ARCHIVE_KEY_FILE, encoder.encode(JSON.stringify(stored)));
  return { publicKey: stored.publicKey, privateKey: pair.privateKey };
}

/**
 * The archive key already on Drive, or a refusal that says which problem it is.
 *
 * `missing` and `unreadable` are kept apart deliberately: the first means this
 * account has never used Simple mode, the second means something is wrong with a
 * key that archives may already depend on. Treating them alike would let a
 * corrupted key be replaced, which silently orphans every archive sealed to it.
 */
export async function loadArchiveKey(drive: ArchiveKeyStore): Promise<ArchiveKeyPair> {
  const file = await drive.find(ARCHIVE_KEY_FILE);
  if (!file) {
    throw new ArchiveKeyError('This backup has no archive key in Drive.', 'missing');
  }

  let stored: StoredArchiveKey;
  try {
    stored = JSON.parse(decoder.decode(await drive.download(file.id))) as StoredArchiveKey;
  } catch {
    throw new ArchiveKeyError('The archive key in Drive could not be read.', 'unreadable');
  }

  if (stored.version !== 1) {
    throw new ArchiveKeyError('This backup key was written by a newer version of PINGO.', 'unsupported');
  }
  if (!stored.privateKey || !stored.publicKey) {
    throw new ArchiveKeyError('The archive key in Drive is incomplete.', 'unreadable');
  }

  try {
    return { publicKey: stored.publicKey, privateKey: await importPrivate(stored.privateKey) };
  } catch {
    throw new ArchiveKeyError('The archive key in Drive could not be imported.', 'unreadable');
  }
}

/** Does this account have Simple Backup set up? Cheap enough to ask on render. */
export async function hasArchiveKey(drive: ArchiveKeyStore): Promise<boolean> {
  return (await drive.find(ARCHIVE_KEY_FILE)) !== undefined;
}
