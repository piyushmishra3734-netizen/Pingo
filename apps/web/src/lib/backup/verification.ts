/**
 * Reading a backup back before calling it one.
 *
 * "Backup complete" is a claim about a remote object, and until it has been
 * read back it is a claim about an intention. Everything here re-reads what was
 * just written, from the pointer down to the bytes, and refuses to let the UI
 * say the word until it adds up.
 *
 * ## Where this runs, and why the order is not negotiable
 *
 * The commit sequence is chunks, manifest, HEAD, then delete the old
 * generation. Verification runs *between the last two*:
 *
 *     chunks → manifest → HEAD → VERIFY → delete old
 *
 * After HEAD, because verifying anything else is verifying a file nobody points
 * at. Before the delete, because a failure here means a bad generation is live
 * and the only correct response is to put the pointer back — and the previous
 * generation has to still exist for that to be possible. Deleting first would
 * leave a failed verification with nothing to fall back to, which converts a
 * recoverable bad backup into no backup at all.
 *
 * ## Never claims more than it did
 *
 * Structural checks always run in full. Digest checks may sample on a large
 * archive, because they cost a full re-download. When they sample, the result
 * says so and says how many were read, so nothing upstream can present a
 * sampled pass as a complete one.
 */
import type { ArchiveManifest } from './drive/archive.js';

/** What verification needs from wherever the archive lives. */
export interface VerificationStore {
  /** The live pointer. Undefined means no backup is committed. */
  head(): Promise<{ generation: number } | undefined>;
  /** Point HEAD at a generation, for rollback. */
  writeHead(generation: number): Promise<void>;
  /** Remove HEAD entirely, when there is nothing safe to point at. */
  removeHead(): Promise<void>;
  /** Generations that have a manifest present, newest order irrelevant. */
  generations(): Promise<number[]>;
  /** Raw manifest bytes, unparsed, so a manifest that will not parse is visible. */
  readManifest(generation: number): Promise<string | undefined>;
  /** Size of a stored chunk without downloading it, when the store knows. */
  chunkSize(generation: number, index: number): Promise<number | undefined>;
  /** The stored chunk bytes. Only called for chunks whose digest is checked. */
  readChunk(generation: number, index: number): Promise<Uint8Array | undefined>;
}

/** The completeness block the proof produced, as recorded in the archive header. */
export interface CompletenessBlock {
  conversations: number;
  messages: number;
  provenAt: number;
}

export type CheckStatus = 'passed' | 'failed' | 'skipped';

export interface CheckResult {
  name: string;
  status: CheckStatus;
  /** Present on failure, and on a skip to say why it was not run. */
  detail?: string;
}

export interface VerificationResult {
  status: 'verified' | 'failed';
  generation: number;
  checks: CheckResult[];
  /** How much of the digest pass actually ran. Never rounded up. */
  digests: { checked: number; total: number; sampled: boolean };
  failures: string[];
  /** Set when a failure caused HEAD to be moved back. */
  rolledBackTo?: number;
  /** Set when a failure left no safe generation to point at. */
  headCleared?: boolean;
}

/**
 * Above this many chunks, the digest pass samples rather than reading every one.
 *
 * A verified backup costs roughly double the bandwidth, which is the right
 * default for something whose entire value is being trustworthy on a day nobody
 * planned for. It stops being the right default when the archive is a gigabyte.
 */
export const FULL_DIGEST_LIMIT = 64;
/** Chunks read when sampling. Always includes the first and the last. */
export const DIGEST_SAMPLE = 16;

const toBase64 = (bytes: Uint8Array) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

async function digestOf(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer);
  return toBase64(new Uint8Array(hash));
}

/**
 * Which chunk indexes to read digests for.
 *
 * The first and last are always included: the tail is where a truncated upload
 * shows, and a sample that could miss it would pass the one failure most likely
 * to happen. The rest are spread evenly rather than chosen at random, so a
 * verification that passes is reproducible and a bug report can be re-run.
 */
export function digestSample(chunkCount: number, limit = FULL_DIGEST_LIMIT, sample = DIGEST_SAMPLE): number[] {
  if (chunkCount <= limit) return Array.from({ length: chunkCount }, (_, i) => i);

  const picks = new Set<number>([0, chunkCount - 1]);
  const step = (chunkCount - 1) / (sample - 1);
  for (let i = 1; i < sample - 1; i += 1) picks.add(Math.round(i * step));
  return [...picks].sort((a, b) => a - b);
}

/** Is this parsed value shaped like a manifest we can verify against? */
function isManifest(value: unknown): value is ArchiveManifest {
  if (typeof value !== 'object' || value === null) return false;
  const m = value as Partial<ArchiveManifest>;
  return (
    typeof m.generation === 'number' &&
    typeof m.chunkCount === 'number' &&
    typeof m.epk === 'string' &&
    Array.isArray(m.chunks)
  );
}

/**
 * Verify the generation that was just committed.
 *
 * Every check is recorded whether it passed, failed or was not run. A caller
 * that wants to say "verified" has to look at `status`, and a caller that wants
 * to say how thoroughly has the numbers to do it honestly.
 */
export async function verifyBackup(
  store: VerificationStore,
  expected: {
    generation: number;
    /** The proof's completeness block, if the archive carries one. */
    completeness?: CompletenessBlock;
  },
  options: {
    /**
     * Reads the archive header, which requires the recovery key.
     *
     * Injected rather than assumed: verification of the structure is possible
     * without any key at all, and a caller that cannot decrypt should get an
     * honest "not checked" rather than a silently skipped check.
     */
    readHeader?: (generation: number) => Promise<{ completeness?: CompletenessBlock } | undefined>;
    fullDigestLimit?: number;
    digestSampleSize?: number;
    /** Roll HEAD back on failure. On by default; off for a dry run. */
    rollback?: boolean;
  } = {},
): Promise<VerificationResult> {
  const checks: CheckResult[] = [];
  const failures: string[] = [];
  const pass = (name: string) => checks.push({ name, status: 'passed' });
  const fail = (name: string, detail: string) => {
    checks.push({ name, status: 'failed', detail });
    failures.push(detail);
  };
  const skip = (name: string, detail: string) => checks.push({ name, status: 'skipped', detail });

  let digests = { checked: 0, total: 0, sampled: false };

  const finish = async (): Promise<VerificationResult> => {
    const result: VerificationResult = {
      status: failures.length === 0 ? 'verified' : 'failed',
      generation: expected.generation,
      checks,
      digests,
      failures,
    };
    if (result.status === 'failed' && (options.rollback ?? true)) {
      Object.assign(result, await rollBack(store, expected.generation));
    }
    return result;
  };

  /*
   * The pointer first. Everything below is a statement about the generation
   * HEAD names, so a HEAD that names something else makes the rest of the
   * checks true about a file nobody will ever read.
   */
  const head = await store.head();
  if (!head) {
    fail('head', 'HEAD is missing, so nothing is committed.');
    return finish();
  }
  if (head.generation !== expected.generation) {
    fail(
      'head',
      `HEAD points at generation ${head.generation}, not the ${expected.generation} just written.`,
    );
    return finish();
  }
  pass('head');

  const raw = await store.readManifest(expected.generation);
  if (raw === undefined) {
    fail('manifest', `No manifest for generation ${expected.generation}.`);
    return finish();
  }

  let manifest: ArchiveManifest;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isManifest(parsed)) throw new Error('shape');
    manifest = parsed;
  } catch {
    fail('manifest', 'The manifest could not be read.');
    return finish();
  }

  if (manifest.generation !== expected.generation) {
    fail(
      'manifest',
      `The manifest says generation ${manifest.generation}, not ${expected.generation}.`,
    );
    return finish();
  }
  pass('manifest');

  if (manifest.chunks.length !== manifest.chunkCount) {
    fail(
      'chunk-count',
      `The manifest lists ${manifest.chunks.length} chunks but claims ${manifest.chunkCount}.`,
    );
  } else {
    pass('chunk-count');
  }

  /*
   * Encryption metadata, checked even though a plaintext archive should be
   * impossible to produce.
   *
   * The cost is one comparison and the failure it catches is total, so it is
   * checked rather than reasoned about. An archive that reached Drive without
   * an ephemeral key or without per-chunk IVs is one Google can read.
   */
  const missingIv = manifest.chunks.filter((c) => !c.iv).map((c) => c.index);
  if (!manifest.epk) {
    fail('encryption', 'The manifest carries no ephemeral key, so the archive is not sealed.');
  } else if (missingIv.length > 0) {
    fail('encryption', `Chunks ${missingIv.join(', ')} have no IV, so they are not sealed.`);
  } else {
    pass('encryption');
  }

  /*
   * Presence and size run in full, always. They are metadata reads rather than
   * downloads, so sampling them would save nothing and give up the check most
   * likely to catch an upload Drive reported as fine.
   */
  const missing: number[] = [];
  const wrongSize: string[] = [];
  for (const entry of manifest.chunks) {
    const size = await store.chunkSize(expected.generation, entry.index);
    if (size === undefined) {
      missing.push(entry.index);
    } else if (size !== entry.bytes) {
      wrongSize.push(`${entry.index} is ${size} bytes, expected ${entry.bytes}`);
    }
  }
  if (missing.length > 0) fail('chunks-present', `Missing chunks: ${missing.join(', ')}.`);
  else pass('chunks-present');

  if (wrongSize.length > 0) fail('chunk-sizes', `Wrong size: ${wrongSize.join('; ')}.`);
  else pass('chunk-sizes');

  const indexes = digestSample(
    manifest.chunks.length,
    options.fullDigestLimit ?? FULL_DIGEST_LIMIT,
    options.digestSampleSize ?? DIGEST_SAMPLE,
  );
  digests = { checked: 0, total: manifest.chunks.length, sampled: indexes.length < manifest.chunks.length };

  const badDigest: number[] = [];
  for (const index of indexes) {
    const entry = manifest.chunks.find((c) => c.index === index);
    if (!entry) continue;
    const bytes = await store.readChunk(expected.generation, index);
    if (!bytes) {
      badDigest.push(index);
      continue;
    }
    digests.checked += 1;
    if ((await digestOf(bytes)) !== entry.digest) badDigest.push(index);
  }

  if (badDigest.length > 0) {
    fail('chunk-digests', `Corrupt chunks: ${badDigest.join(', ')}.`);
  } else if (digests.sampled) {
    checks.push({
      name: 'chunk-digests',
      status: 'passed',
      detail: `${digests.checked} of ${digests.total} chunks read.`,
    });
  } else {
    pass('chunk-digests');
  }

  /*
   * The header is the only check that says anything about *which account state*
   * this archive holds. Everything above proves the bytes are the bytes that
   * were uploaded; this proves they are the bytes that were meant to be.
   */
  if (!options.readHeader) {
    skip('header', 'The header was not read, so completeness was not confirmed.');
  } else if (!expected.completeness) {
    skip('header', 'No completeness proof was supplied to compare against.');
  } else {
    let header: { completeness?: CompletenessBlock } | undefined;
    try {
      header = await options.readHeader(expected.generation);
    } catch (cause) {
      header = undefined;
      fail('header', `The header could not be read: ${cause instanceof Error ? cause.message : 'unknown'}.`);
    }

    if (header !== undefined) {
      const got = header.completeness;
      if (!got) {
        fail('header', 'The archive header carries no completeness block.');
      } else if (
        got.conversations !== expected.completeness.conversations ||
        got.messages !== expected.completeness.messages
      ) {
        fail(
          'header',
          `The header records ${got.messages} messages in ${got.conversations} chats, ` +
            `but ${expected.completeness.messages} in ${expected.completeness.conversations} were proven.`,
        );
      } else {
        pass('header');
      }
    }
  }

  return finish();
}

/**
 * Put the pointer back after a failed verification.
 *
 * Rolls to the newest generation older than the failed one that still has a
 * manifest — the previous good backup is still the good backup until this one
 * has earned the title, and leaving HEAD on something unverified would mean a
 * future restore reads it.
 *
 * When there is nothing older, HEAD is removed rather than left pointing at the
 * failure. That is the first-backup case, and "no backup" is the honest state:
 * telling someone they have a backup that did not verify is worse than telling
 * them they have none, because only one of those gets acted on.
 */
async function rollBack(
  store: VerificationStore,
  failed: number,
): Promise<{ rolledBackTo?: number; headCleared?: boolean }> {
  const older = (await store.generations()).filter((g) => g < failed).sort((a, b) => b - a);

  for (const generation of older) {
    // Only point at a generation that still has a manifest to read.
    if ((await store.readManifest(generation)) !== undefined) {
      await store.writeHead(generation);
      return { rolledBackTo: generation };
    }
  }

  await store.removeHead();
  return { headCleared: true };
}

/**
 * What the UI is allowed to say about this result.
 *
 * Built here rather than at the call site so that "Backup complete" cannot be
 * written next to a sampled or partial verification by someone reading only
 * `status`.
 */
export function verificationHeadline(result: VerificationResult): string {
  if (result.status === 'failed') {
    if (result.rolledBackTo !== undefined) {
      return `Backup failed to verify. Your previous backup from generation ${result.rolledBackTo} is still in place.`;
    }
    return 'Backup failed to verify and was not kept.';
  }
  /*
   * Two different reasons to qualify the word, and they are not the same thing.
   * A sampled digest pass read some of the bytes; a skipped header check read
   * all of them and still cannot say the archive holds the right account state.
   * Collapsing them produced "spot-checked (4 of 4 parts read)", which manages
   * to be both reassuring and wrong.
   */
  const qualifiers: string[] = [];
  if (result.digests.sampled) {
    qualifiers.push(`spot-checked (${result.digests.checked} of ${result.digests.total} parts read)`);
  }
  if (result.checks.some((c) => c.name === 'header' && c.status === 'skipped')) {
    qualifiers.push('completeness not confirmed');
  }
  if (qualifiers.length > 0) return `Backup complete, ${qualifiers.join(', ')}.`;
  return 'Backup complete and fully verified.';
}
