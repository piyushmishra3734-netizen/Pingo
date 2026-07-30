/**
 * The encrypted chat archive: how it is sealed, split, and checked.
 *
 * Deliberately knows nothing about Drive. It turns bytes into chunks that a
 * dumb blob store can hold, and turns them back, refusing anything that does
 * not add up. That separation is what lets the interesting failures — a
 * truncated upload, a swapped chunk, a replayed old generation — be tested
 * without a network at all.
 *
 * ## Keyed from the recovery key, not the device
 *
 * A restoring device is by definition a device that does not have the old
 * one's database key, so sealing the archive with that key would produce a
 * backup only the machine that made it could read. Instead an ephemeral keypair
 * is generated per archive and ECDH'd against the account's *recovery* public
 * key, exactly as a message envelope wraps a content key. The ephemeral public
 * half travels in the manifest; the recovery private key is what opens it.
 *
 * Google therefore holds ciphertext and an ephemeral public key, which together
 * reveal nothing. Our server holds the same. Neither can decrypt without the
 * 12-word code, which exists only in the user's head or on paper.
 */

const CHUNK_INFO = new TextEncoder().encode('pingo/archive/v1');

/** 4 MiB of plaintext per chunk. Big enough to be efficient, small enough to retry. */
export const DEFAULT_CHUNK_SIZE = 4 * 1024 * 1024;

export interface ArchiveChunk {
  index: number;
  /** AES-GCM output, tag included. */
  bytes: Uint8Array;
}

export interface ArchiveManifest {
  version: 1;
  /**
   * Increments on every archive. The commit point and the replay defence:
   * a restore refuses a generation older than one it has already accepted.
   */
  generation: number;
  /** SPKI, base64. Public half of the per-archive ephemeral key. */
  epk: string;
  chunkCount: number;
  /** Plaintext length, so truncation is detectable after decryption too. */
  totalBytes: number;
  /** Per-chunk: the IV it was sealed with, and a digest of the ciphertext. */
  chunks: Array<{ index: number; iv: string; digest: string; bytes: number }>;
  createdAt: number;
}

export class ArchiveError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'chunk-missing'
      | 'chunk-corrupt'
      | 'chunk-count'
      | 'length-mismatch'
      | 'unsupported'
      | 'rolled-back',
  ) {
    super(message);
    this.name = 'ArchiveError';
  }
}

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

/*
 * Exposed for the streaming builder, which produces this exact format without
 * holding the archive in memory. Kept here rather than duplicated there so
 * there is one definition of how a chunk is sealed and bound to its place.
 */
export { archiveKey as deriveArchiveKey, chunkAad, digest as chunkDigest, importPublic as importArchivePublicKey, toBase64 as archiveBase64 };

async function digest(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer);
  return toBase64(new Uint8Array(hash));
}

async function importPublic(spki: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'spki',
    fromBase64(spki) as unknown as ArrayBuffer,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    [],
  );
}

async function archiveKey(
  privateKey: CryptoKey,
  publicKey: CryptoKey,
  usage: KeyUsage[],
): Promise<CryptoKey> {
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256);
  const hkdf = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: CHUNK_INFO },
    hkdf,
    { name: 'AES-GCM', length: 256 },
    false,
    usage,
  );
}

/**
 * Bind each chunk to its place.
 *
 * The generation and index go in as additional authenticated data, so a chunk
 * lifted from an older archive, or moved to a different position in this one,
 * fails to open rather than decrypting into plausible nonsense in the wrong
 * order. GCM checks this for free; leaving it out would make reordering
 * undetectable.
 */
function chunkAad(generation: number, index: number, chunkCount: number): Uint8Array {
  return new TextEncoder().encode(`pingo/archive/v1|${generation}|${index}|${chunkCount}`);
}

export async function sealArchive(
  plaintext: Uint8Array,
  recoveryPublicKey: string,
  generation: number,
  chunkSize = DEFAULT_CHUNK_SIZE,
): Promise<{ manifest: ArchiveManifest; chunks: ArchiveChunk[] }> {
  const theirs = await importPublic(recoveryPublicKey);
  const ephemeral = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ]);
  const key = await archiveKey(ephemeral.privateKey, theirs, ['encrypt']);

  const chunkCount = Math.max(1, Math.ceil(plaintext.length / chunkSize));
  const chunks: ArchiveChunk[] = [];
  const meta: ArchiveManifest['chunks'] = [];

  for (let index = 0; index < chunkCount; index += 1) {
    const slice = plaintext.subarray(index * chunkSize, (index + 1) * chunkSize);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const sealed = new Uint8Array(
      await crypto.subtle.encrypt(
        {
          name: 'AES-GCM',
          iv,
          additionalData: chunkAad(generation, index, chunkCount) as unknown as ArrayBuffer,
        },
        key,
        slice as unknown as ArrayBuffer,
      ),
    );

    chunks.push({ index, bytes: sealed });
    meta.push({
      index,
      iv: toBase64(iv),
      digest: await digest(sealed),
      bytes: sealed.length,
    });
  }

  return {
    manifest: {
      version: 1,
      generation,
      epk: toBase64(new Uint8Array(await crypto.subtle.exportKey('spki', ephemeral.publicKey))),
      chunkCount,
      totalBytes: plaintext.length,
      chunks: meta,
      createdAt: Date.now(),
    },
    chunks,
  };
}

/**
 * Rebuild the plaintext, or refuse.
 *
 * Every check here exists because the alternative is silently restoring
 * something wrong: a missing chunk would shorten history without saying so, a
 * corrupted one would surface as unreadable messages, and a wrong count would
 * quietly drop the tail.
 */
export async function openArchive(
  manifest: ArchiveManifest,
  chunks: ArchiveChunk[],
  recoveryPrivateKey: CryptoKey,
  seenGeneration = 0,
): Promise<Uint8Array> {
  if (manifest.version !== 1) {
    throw new ArchiveError('This backup was written by a newer version of PINGO.', 'unsupported');
  }

  if (manifest.generation < seenGeneration) {
    throw new ArchiveError(
      'This backup is older than one already restored. It may be a replay.',
      'rolled-back',
    );
  }

  if (chunks.length !== manifest.chunkCount) {
    throw new ArchiveError(
      `Backup is incomplete: expected ${manifest.chunkCount} parts, found ${chunks.length}.`,
      'chunk-count',
    );
  }

  const epk = await importPublic(manifest.epk);
  const key = await archiveKey(recoveryPrivateKey, epk, ['decrypt']);
  const byIndex = new Map(chunks.map((chunk) => [chunk.index, chunk]));
  const parts: Uint8Array[] = [];

  for (const entry of manifest.chunks) {
    const chunk = byIndex.get(entry.index);
    if (!chunk) {
      throw new ArchiveError(`Backup part ${entry.index} is missing.`, 'chunk-missing');
    }

    /*
     * Digest first, so a damaged chunk is reported as damaged rather than as a
     * decryption failure. Both refuse, but only one of them tells the user
     * whether the problem is the file or the code.
     */
    if ((await digest(chunk.bytes)) !== entry.digest) {
      throw new ArchiveError(`Backup part ${entry.index} is damaged.`, 'chunk-corrupt');
    }

    try {
      const opened = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: fromBase64(entry.iv) as unknown as ArrayBuffer,
          additionalData: chunkAad(
            manifest.generation,
            entry.index,
            manifest.chunkCount,
          ) as unknown as ArrayBuffer,
        },
        key,
        chunk.bytes as unknown as ArrayBuffer,
      );
      parts.push(new Uint8Array(opened));
    } catch {
      throw new ArchiveError(`Backup part ${entry.index} could not be opened.`, 'chunk-corrupt');
    }
  }

  const total = parts.reduce((sum, part) => sum + part.length, 0);
  if (total !== manifest.totalBytes) {
    throw new ArchiveError(
      `Backup is the wrong size: expected ${manifest.totalBytes} bytes, rebuilt ${total}.`,
      'length-mismatch',
    );
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
