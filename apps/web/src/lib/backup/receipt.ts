/**
 * The immutable record of what a backup actually contained.
 *
 * Every successful backup writes one receipt, and a restore checks what it
 * received against the receipt that was written when the archive was made. A
 * backup that cannot say what it contained cannot tell you that it came back
 * whole, and "the restore finished" is not the same claim as "the restore was
 * complete".
 *
 * ## Immutable against whom
 *
 * The receipt lives beside the archive, so it lives on Google Drive, so Google
 * can rewrite it. Storage cannot make it immutable. Cryptography can: the body
 * is sealed under a key derived from the account's recovery key, so a receipt
 * can be *deleted* by whoever holds the file, and cannot be *forged* or edited
 * by anyone. That is the property a restore needs — a tampered receipt fails to
 * open rather than lying convincingly.
 *
 * ## Why sealed rather than signed
 *
 * A signature would make the receipt tamper-evident while leaving the counts
 * readable, and §9.4 already decided that message counts do not go where Google
 * can read them: the manifest is plaintext, and a per-conversation count is a
 * finer-grained signal than the archive size Drive can already see. So the body
 * is encrypted and the envelope carries only what is needed to find the key —
 * all of which is already implied by the file's location.
 *
 * ## A separate key from the chunks
 *
 * The receipt key is HKDF'd from the same ECDH secret under a different info
 * label, so a key that opens receipts never opens message chunks. The suite
 * proves this by attempting exactly that and failing if it ever succeeds.
 */
import {
  archiveBase64,
  archiveFromBase64,
  importArchivePublicKey,
  type ArchiveManifest,
} from './drive/archive.js';

const RECEIPT_INFO = new TextEncoder().encode('pingo/receipt/v1');
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type BackupMode = 'simple' | 'private';
export type VerificationStatus = 'verified' | 'sampled' | 'unverified' | 'failed';
export type CompletenessStatus = 'proven' | 'partial' | 'unproven';

/**
 * What one backup contained, recorded when it was made.
 *
 * Written once and never edited. A later backup writes a new receipt with a new
 * generation; it does not amend this one.
 */
export interface BackupReceipt {
  receiptVersion: 1;
  /** Stable identity of this backup, independent of its position in the chain. */
  backupId: string;
  createdAt: number;
  generation: number;

  conversations: number;
  messages: number;
  mediaFiles: number;
  /**
   * Messages left out because this device could not decrypt them.
   *
   * On the receipt rather than only in the proof, because the receipt is what a
   * restore is checked against. A backup that quietly contained less than it
   * claimed is the failure this whole record exists to prevent.
   */
  unreadable: number;
  archiveBytes: number;

  /** SHA-256 of the canonical manifest. */
  manifestHash: string;
  /** Root over the ordered chunk digests — see `computeArchiveHash`. */
  archiveHash: string;

  mode: BackupMode;
  keyVersion: number;
  verification: VerificationStatus;
  completeness: CompletenessStatus;

  /**
   * Hash of the previous sealed receipt, forming a chain.
   *
   * Inside the sealed body on purpose. A link an attacker can rewrite is not a
   * chain, and putting it here means the chain cannot be re-stitched without
   * the recovery key. Absent on the first backup, which is the only receipt
   * allowed to have no predecessor.
   */
  previousHash?: string;
}

/**
 * The receipt as it sits on Drive.
 *
 * The envelope is plaintext because the key derivation needs it and because all
 * of it is already implied by the file's path. Nothing about the account's size
 * or contents is here.
 */
export interface SealedReceipt {
  version: 1;
  backupId: string;
  generation: number;
  mode: BackupMode;
  keyVersion: number;
  /** SPKI, base64. Public half of this receipt's ephemeral key. */
  epk: string;
  iv: string;
  /** AES-GCM over the canonical receipt JSON. */
  body: string;
}

export class ReceiptError extends Error {
  constructor(
    message: string,
    readonly code: 'tampered' | 'unsupported' | 'chain-broken' | 'rolled-back',
  ) {
    super(message);
    this.name = 'ReceiptError';
  }
}

/**
 * JSON with keys in a fixed order, so the same receipt always hashes the same.
 *
 * `JSON.stringify` preserves insertion order, so two logically identical
 * receipts built by different code paths would otherwise produce different
 * hashes and a spurious mismatch at restore — the exact false alarm this whole
 * module exists to avoid raising.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

async function sha256(text: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(text) as unknown as ArrayBuffer);
  return archiveBase64(new Uint8Array(hash));
}

/** SHA-256 of the canonical manifest, so any field change moves it. */
export function computeManifestHash(manifest: ArchiveManifest): Promise<string> {
  return sha256(canonicalJson(manifest));
}

/**
 * One hash standing for the whole archive.
 *
 * A root over the ordered per-chunk digests, which the builder already computes,
 * so this costs nothing and needs no re-read. The count and each index go into
 * the preimage, so dropping the last chunk or swapping two of them changes the
 * hash — a plain concatenation would let a reorder pass.
 */
export function computeArchiveHash(chunks: Array<{ index: number; digest: string }>): Promise<string> {
  const ordered = [...chunks].sort((a, b) => a.index - b.index);
  const preimage = `pingo/archive-root/v1|${ordered.length}|${ordered
    .map((c) => `${c.index}:${c.digest}`)
    .join('|')}`;
  return sha256(preimage);
}

/** Hash of a sealed receipt, which is what the next receipt's chain links to. */
export function sealedReceiptHash(sealed: SealedReceipt): Promise<string> {
  return sha256(canonicalJson(sealed));
}

/**
 * Bind the plaintext envelope to the sealed body.
 *
 * Without this the envelope is unauthenticated and its fields can be edited —
 * a receipt could be re-labelled as a different generation, or as Private mode
 * when it was Simple, while its body still opened cleanly. With it, editing any
 * of them makes the body fail to decrypt.
 */
function receiptAad(sealed: Pick<SealedReceipt, 'backupId' | 'generation' | 'mode' | 'keyVersion'>) {
  return encoder.encode(
    `pingo/receipt/v1|${sealed.backupId}|${sealed.generation}|${sealed.mode}|${sealed.keyVersion}`,
  );
}

/**
 * The receipt key: same ECDH secret as the archive, different HKDF label.
 *
 * Deriving both from one secret keeps the key hierarchy as it was — whoever can
 * open the archive can read its receipt, and nobody else — while the distinct
 * `info` means neither key is the other.
 */
async function receiptKey(
  privateKey: CryptoKey,
  publicKey: CryptoKey,
  usage: KeyUsage[],
): Promise<CryptoKey> {
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256);
  const hkdf = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: RECEIPT_INFO },
    hkdf,
    { name: 'AES-GCM', length: 256 },
    false,
    usage,
  );
}

/** Seal a receipt to the account's recovery public key. */
export async function sealReceipt(
  receipt: BackupReceipt,
  recoveryPublicKey: string,
): Promise<SealedReceipt> {
  const theirs = await importArchivePublicKey(recoveryPublicKey);
  const ephemeral = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ]);
  const key = await receiptKey(ephemeral.privateKey, theirs, ['encrypt']);

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const envelope = {
    backupId: receipt.backupId,
    generation: receipt.generation,
    mode: receipt.mode,
    keyVersion: receipt.keyVersion,
  };
  const body = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: receiptAad(envelope) as unknown as ArrayBuffer },
      key,
      encoder.encode(canonicalJson(receipt)) as unknown as ArrayBuffer,
    ),
  );

  return {
    version: 1,
    ...envelope,
    epk: archiveBase64(new Uint8Array(await crypto.subtle.exportKey('spki', ephemeral.publicKey))),
    iv: archiveBase64(iv),
    body: archiveBase64(body),
  };
}

/**
 * Open a receipt, or refuse it.
 *
 * There is no partial success. A receipt that does not decrypt is one that
 * somebody edited, and reading a subset of a tampered record would be worse
 * than having none — it is the record a restore is about to trust.
 */
export async function openReceipt(
  sealed: SealedReceipt,
  recoveryPrivateKey: CryptoKey,
): Promise<BackupReceipt> {
  if (sealed.version !== 1) {
    throw new ReceiptError(`Unsupported receipt version ${sealed.version}.`, 'unsupported');
  }

  const theirs = await importArchivePublicKey(sealed.epk);
  const key = await receiptKey(recoveryPrivateKey, theirs, ['decrypt']);

  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: archiveFromBase64(sealed.iv) as unknown as ArrayBuffer,
        additionalData: receiptAad(sealed) as unknown as ArrayBuffer,
      },
      key,
      archiveFromBase64(sealed.body) as unknown as ArrayBuffer,
    );
  } catch {
    throw new ReceiptError('The backup receipt has been altered and cannot be trusted.', 'tampered');
  }

  const receipt = JSON.parse(decoder.decode(plaintext)) as BackupReceipt;

  /*
   * The envelope and the body must agree.
   *
   * They are separately attacker-visible, and the AAD already ties them
   * together, so a disagreement means something is wrong in a way that should
   * be loud rather than resolved by preferring one of them.
   */
  if (
    receipt.backupId !== sealed.backupId ||
    receipt.generation !== sealed.generation ||
    receipt.mode !== sealed.mode ||
    receipt.keyVersion !== sealed.keyVersion
  ) {
    throw new ReceiptError('The receipt envelope disagrees with its contents.', 'tampered');
  }

  return receipt;
}

/**
 * Check a chain of receipts, newest last.
 *
 * Catches a deleted or reordered history. It cannot catch a chain truncated at
 * the *newest* end — an attacker who deletes the last receipt leaves a shorter
 * chain that is internally perfect — which is why the newest hash is also
 * pinned locally and, per the security review, why the server keeps a
 * generation floor. Recorded here so the limit is not mistaken for coverage.
 */
export async function verifyReceiptChain(
  entries: Array<{ sealed: SealedReceipt; receipt: BackupReceipt }>,
): Promise<void> {
  for (let i = 0; i < entries.length; i += 1) {
    const { receipt } = entries[i]!;
    if (i === 0) {
      continue;
    }
    const expected = await sealedReceiptHash(entries[i - 1]!.sealed);
    if (receipt.previousHash !== expected) {
      throw new ReceiptError(
        `Backup ${receipt.generation} does not follow backup ${entries[i - 1]!.receipt.generation}.`,
        'chain-broken',
      );
    }
    if (receipt.generation <= entries[i - 1]!.receipt.generation) {
      throw new ReceiptError(
        `Backup generation went backwards: ${entries[i - 1]!.receipt.generation} then ${receipt.generation}.`,
        'rolled-back',
      );
    }
  }
}

/** What a restore actually produced, measured after it ran. */
export interface RestoreObservation {
  conversations: number;
  messages: number;
  manifestHash: string;
  archiveHash: string;
}

export interface RestoreWarning {
  code: 'chats' | 'messages' | 'manifest-hash' | 'archive-hash' | 'unverifiable';
  message: string;
  expected?: string;
  actual?: string;
}

/**
 * The outcome of checking a restore.
 *
 * Deliberately not a boolean. Every call site has to name which of the three
 * states it is in, so "restored with warnings" cannot be written as `if (ok)`
 * and quietly become "restored".
 */
export type RestoreStatus = 'verified' | 'warned' | 'unverifiable';

export interface RestoreVerification {
  status: RestoreStatus;
  warnings: RestoreWarning[];
  /** One line to show the user. Never "complete" unless it was. */
  headline: string;
}

const shortHash = (h: string) => h.slice(0, 12);

/**
 * Compare what came back against what was recorded.
 *
 * A mismatch never blocks the restore. The data that did arrive is the user's
 * data and withholding it helps nobody — but it is never reported as a complete
 * restore either, which is the whole point of writing the receipt.
 *
 * Worth being precise about what a hash mismatch means here: the chunks are
 * AES-GCM and the receipt is sealed, so an attacker cannot produce an archive
 * that decrypts *and* hashes differently. Reaching this path means the receipt
 * belongs to a different backup than the one restored — a stale pointer, a
 * partially rolled-back generation — not forged content. Forged content fails
 * earlier, at decryption, and never gets here.
 */
export function verifyRestore(
  receipt: BackupReceipt | undefined,
  observed: RestoreObservation,
): RestoreVerification {
  if (!receipt) {
    return {
      status: 'unverifiable',
      warnings: [
        {
          code: 'unverifiable',
          message: 'There was no readable backup receipt, so the restore could not be checked.',
        },
      ],
      headline: 'Restored, but we could not verify it was complete.',
    };
  }

  const warnings: RestoreWarning[] = [];

  if (observed.conversations !== receipt.conversations) {
    warnings.push({
      code: 'chats',
      message: `Expected ${receipt.conversations} chats, restored ${observed.conversations}.`,
      expected: String(receipt.conversations),
      actual: String(observed.conversations),
    });
  }
  if (observed.messages !== receipt.messages) {
    warnings.push({
      code: 'messages',
      message: `Expected ${receipt.messages} messages, restored ${observed.messages}.`,
      expected: String(receipt.messages),
      actual: String(observed.messages),
    });
  }
  if (observed.manifestHash !== receipt.manifestHash) {
    warnings.push({
      code: 'manifest-hash',
      message: 'The backup index does not match the one recorded when the backup was made.',
      expected: shortHash(receipt.manifestHash),
      actual: shortHash(observed.manifestHash),
    });
  }
  if (observed.archiveHash !== receipt.archiveHash) {
    warnings.push({
      code: 'archive-hash',
      message: 'The restored archive does not match the one recorded when the backup was made.',
      expected: shortHash(receipt.archiveHash),
      actual: shortHash(observed.archiveHash),
    });
  }

  if (warnings.length === 0) {
    return {
      status: 'verified',
      warnings,
      headline: `Restored ${receipt.messages.toLocaleString()} messages across ${receipt.conversations.toLocaleString()} chats.`,
    };
  }

  /*
   * Missing is worded differently from merely different.
   *
   * "Fewer than expected" is the case a user needs to act on — check the other
   * device, do not wipe it yet — and it reads differently from a count that
   * moved because history was deleted on purpose.
   */
  const short = observed.messages < receipt.messages;
  return {
    status: 'warned',
    warnings,
    headline: short
      ? `Restored ${observed.messages.toLocaleString()} of ${receipt.messages.toLocaleString()} messages. Some history is missing.`
      : 'Restored, but the backup does not match its original record.',
  };
}

/** The receipt as a support-safe summary: no ids, no content, just the record. */
export function formatReceipt(receipt: BackupReceipt): string {
  const rows: Array<[string, string]> = [
    ['Backup ID', receipt.backupId],
    ['Created', new Date(receipt.createdAt).toISOString()],
    ['Generation', String(receipt.generation)],
    ['Chats', receipt.conversations.toLocaleString()],
    ['Messages', receipt.messages.toLocaleString()],
    ['Media files', receipt.mediaFiles.toLocaleString()],
    ...(receipt.unreadable > 0
      ? ([['Not included', `${receipt.unreadable.toLocaleString()} unreadable`]] as Array<[string, string]>)
      : []),
    ['Archive size', `${receipt.archiveBytes.toLocaleString()} B`],
    ['Manifest hash', shortHash(receipt.manifestHash)],
    ['Archive hash', shortHash(receipt.archiveHash)],
    ['Encryption mode', receipt.mode],
    ['Key version', String(receipt.keyVersion)],
    ['Verification', receipt.verification],
    ['Completeness', receipt.completeness],
  ];
  const width = Math.max(...rows.map(([l]) => l.length));
  return rows.map(([l, v]) => `${l.padEnd(width)}  ${v}`).join('\n');
}
