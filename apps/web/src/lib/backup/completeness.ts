/**
 * Proving the local store is complete before anything is archived.
 *
 * A backup that quietly contains less than it claims is worse than one that
 * fails, because it fails later and without warning — on the day the phone is
 * already gone. So the archive does not start until completeness has been
 * *proven*, and proven means measured, not inferred from a run that did not
 * throw.
 *
 * ## Why this is not just the backfill audit again
 *
 * The audit records what the server said during the walk, and states its own
 * limit: every figure in it comes from one endpoint, so a count that is wrong
 * consistently satisfies all of it. This module is the independent check. It
 * asks the server afresh, per conversation, and compares against what is
 * actually in the local row store — not against what backfill remembers
 * downloading. Two sources that were never derived from each other have to
 * agree, which is a materially stronger claim than either one alone.
 *
 * ## Per conversation, never in aggregate
 *
 * A global total can balance perfectly while two conversations are individually
 * wrong — one holding more than the server, one holding less. Summing first
 * would hide exactly the case worth catching, so the sum is computed from the
 * per-conversation results and never used as the gate.
 */
import { conversationRef, isValidCursor } from './backfill.js';

/** "1 message", "2 messages" - this text is shown to users. */
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** Server-side counts. Aggregate queries only; this never fetches history. */
export interface ProofSource {
  conversations(): Promise<string[]>;
  countMessages(conversationId: string): Promise<number>;
}

/** What the device actually holds, read from the row store. */
export interface LocalCounts {
  conversations(): Promise<string[]>;
  countMessages(conversationId: string): Promise<number>;
}

export interface CursorReader {
  read(conversationId: string): Promise<unknown>;
}

/**
 * Why one conversation is or is not proven.
 *
 * `unmeasured` is separate from `short` on purpose, and it is the same
 * distinction preflight draws between an empty account and an unmeasured one: a
 * count that failed and a count that came back low both leave the proof
 * unfinished, but they need opposite words and opposite advice. Collapsing them
 * would let "we could not check" be reported as "you are missing history".
 */
export type ConversationStatus = 'proven' | 'short' | 'not-walked' | 'unmeasured';

export interface ConversationProof {
  conversationId: string;
  /** Short stable stand-in, so a proof can be shared without the id. */
  ref: string;
  serverCount: number;
  localCount: number;
  /** `local - server`. Negative is a shortfall; positive is fine, see below. */
  difference: number;
  cursorComplete: boolean;
  status: ConversationStatus;
  reason?: string;
}

/**
 * The account-level verdict.
 *
 * Three states rather than two. `short` means measured and incomplete;
 * `unverified` means it could not be measured at all. Both refuse to archive,
 * and they are different problems with different fixes.
 */
export type ProofStatus = 'proven' | 'short' | 'unverified';

export interface CompletenessProof {
  status: ProofStatus;
  conversations: ConversationProof[];
  /** How much is missing, for the words shown to the user. */
  shortfall: { conversations: number; messages: number };
  totals: { conversations: number; serverMessages: number; localMessages: number };
  /**
   * Held locally but absent from the server's list.
   *
   * Not a failure. History the server no longer has is the single most valuable
   * thing in the archive — it is the only remaining copy.
   */
  localOnly: string[];
  provenAt: number;
}

export class CompletenessError extends Error {
  constructor(
    message: string,
    readonly code: 'not-proven',
    readonly proof: CompletenessProof,
  ) {
    super(message);
    this.name = 'CompletenessError';
  }
}

/**
 * Run `work` over `items` with at most `limit` in flight.
 *
 * An account of four hundred conversations is four hundred count queries. All
 * at once is a burst a phone network handles badly and a rate limiter handles
 * worse; one at a time is a visible wait before a button that has not started
 * yet.
 */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await work(items[i]!);
    }
  });
  await Promise.all(runners);
  return out;
}

const CONCURRENCY = 8;

/**
 * Measure one conversation against the server.
 *
 * A failure to count is caught here rather than allowed to reject the whole
 * proof: one unreachable conversation should leave the other four hundred
 * measured, so the user is told what is wrong rather than that something is.
 */
async function proveConversation(
  conversationId: string,
  source: ProofSource,
  local: LocalCounts,
  cursors: CursorReader,
): Promise<ConversationProof> {
  const ref = conversationRef(conversationId);

  let serverCount: number;
  let localCount: number;
  try {
    [serverCount, localCount] = await Promise.all([
      source.countMessages(conversationId),
      local.countMessages(conversationId),
    ]);
  } catch (cause) {
    return {
      conversationId,
      ref,
      serverCount: 0,
      localCount: 0,
      difference: 0,
      cursorComplete: false,
      status: 'unmeasured',
      reason: cause instanceof Error ? cause.message : 'the count could not be read',
    };
  }

  const stored = await cursors.read(conversationId);
  const cursorComplete = isValidCursor(stored) && stored.complete;
  const difference = localCount - serverCount;

  /*
   * Both conditions, in this order, because they catch different lies.
   *
   * The counts agreeing says nothing was left behind. The cursor says the walk
   * actually reached the beginning. A conversation can satisfy the first and
   * fail the second when the server under-reports its own history — which is
   * precisely the failure the backfill audit admits it cannot see on its own.
   */
  if (!cursorComplete) {
    return {
      conversationId,
      ref,
      serverCount,
      localCount,
      difference,
      cursorComplete,
      status: 'not-walked',
      reason: 'this chat has not been walked back to its beginning yet',
    };
  }

  if (localCount < serverCount) {
    return {
      conversationId,
      ref,
      serverCount,
      localCount,
      difference,
      cursorComplete,
      status: 'short',
      reason: `${plural(serverCount - localCount, 'message')} on the server ${serverCount - localCount === 1 ? 'is' : 'are'} not held locally`,
    };
  }

  return { conversationId, ref, serverCount, localCount, difference, cursorComplete, status: 'proven' };
}

/**
 * Prove — or refuse to prove — that the local store holds everything the server
 * still has.
 *
 * ## Why `>=` rather than `==`
 *
 * Exact equality is the goal and the wrong gate. Local can legitimately exceed
 * the server: a message deleted for everyone after this device stored it, a
 * conversation cleared server-side while rows remain, or retention expiring
 * history the device already holds — which becomes the normal case once the
 * retention window shortens, and is precisely the state a backup exists to
 * preserve.
 *
 * Local holding *more* is not a defect; it is the feature. What must never
 * happen is the server holding something local does not. So the gate is
 * "nothing on the server is unaccounted for", and the exact difference is
 * reported either way, so a surprising number is visible rather than swallowed.
 */
export async function proveCompleteness(
  source: ProofSource,
  local: LocalCounts,
  cursors: CursorReader,
  options: { concurrency?: number } = {},
): Promise<CompletenessProof> {
  const serverConversations = await source.conversations();
  const localConversations = await local.conversations();

  const conversations = await mapLimit(
    serverConversations,
    options.concurrency ?? CONCURRENCY,
    (id) => proveConversation(id, source, local, cursors),
  );

  const onServer = new Set(serverConversations);
  const localOnly = localConversations.filter((id) => !onServer.has(id));

  let serverMessages = 0;
  let localMessages = 0;
  let shortConversations = 0;
  let shortMessages = 0;
  let unmeasured = 0;

  for (const c of conversations) {
    serverMessages += c.serverCount;
    localMessages += c.localCount;
    if (c.status === 'unmeasured') unmeasured += 1;
    if (c.status === 'short' || c.status === 'not-walked') {
      shortConversations += 1;
      shortMessages += Math.max(0, c.serverCount - c.localCount);
    }
  }

  /*
   * Measured-and-incomplete outranks could-not-measure.
   *
   * If some conversations are known short, that is the actionable fact and the
   * one to lead with; the unmeasured ones are still listed. Reporting
   * "unverified" while holding proof of a shortfall would understate what is
   * known.
   */
  const status: ProofStatus =
    shortConversations > 0 ? 'short' : unmeasured > 0 ? 'unverified' : 'proven';

  return {
    status,
    conversations,
    shortfall: { conversations: shortConversations, messages: shortMessages },
    totals: { conversations: serverConversations.length, serverMessages, localMessages },
    localOnly,
    provenAt: Date.now(),
  };
}

/**
 * The conversations a retry should walk, and nothing else.
 *
 * Retrying means resuming from the cursors for the handful that are short, not
 * restarting the account. On a large account the difference is minutes against
 * an hour, and repeating a walk that already succeeded is how a retry turns
 * into something users learn not to press.
 */
export function conversationsToWalk(proof: CompletenessProof): string[] {
  return proof.conversations
    .filter((c) => c.status === 'short' || c.status === 'not-walked' || c.status === 'unmeasured')
    .map((c) => c.conversationId);
}

/**
 * The completeness block that travels inside the archive.
 *
 * Sealed in the archive header, never in the manifest: the manifest is
 * plaintext to Google, and a message count is a finer-grained signal than the
 * archive size Drive can already see.
 *
 * Throws unless the proof passed. A header is a claim that completeness was
 * proven, so it must be impossible to write one for an account where it was
 * not — which is why this is the only way to construct the block.
 */
export function completenessHeader(proof: CompletenessProof): {
  conversations: number;
  messages: number;
  provenAt: number;
} {
  if (proof.status !== 'proven') {
    throw new CompletenessError(
      proof.status === 'short'
        ? `${plural(proof.shortfall.conversations, 'chat')} ${proof.shortfall.conversations === 1 ? 'is' : 'are'} missing ${plural(proof.shortfall.messages, 'message')}.`
        : 'Completeness could not be verified for every chat.',
      'not-proven',
      proof,
    );
  }
  return {
    conversations: proof.totals.conversations,
    messages: proof.totals.localMessages,
    provenAt: proof.provenAt,
  };
}

/**
 * The proof in words, redacted by default.
 *
 * Same rule as the backfill audit: counts and verdicts only, conversation ids
 * replaced by refs, so this can go into a bug report as-is.
 */
export function formatProof(proof: CompletenessProof, options: { redact?: boolean } = {}): string {
  const redact = options.redact ?? true;
  const idOf = (c: ConversationProof) => (redact ? c.ref : c.conversationId);

  const head =
    proof.status === 'proven'
      ? `Complete: ${plural(proof.totals.localMessages, 'message')} across ${plural(proof.totals.conversations, 'chat')}.`
      : proof.status === 'short'
        ? `Not complete: ${proof.shortfall.conversations} of ${proof.totals.conversations} chats ${proof.shortfall.conversations === 1 ? 'is' : 'are'} missing ${plural(proof.shortfall.messages, 'message')}.`
        : `Could not verify ${proof.conversations.filter((c) => c.status === 'unmeasured').length} of ${proof.totals.conversations} chats.`;

  const problems = proof.conversations.filter((c) => c.status !== 'proven');
  const lines = [head];
  if (problems.length > 0) {
    lines.push('');
    for (const c of problems.slice(0, 20)) {
      lines.push(`  ${idOf(c)}  ${c.localCount} of ${c.serverCount}  ${c.reason ?? c.status}`);
    }
    if (problems.length > 20) lines.push(`  ...and ${problems.length - 20} more`);
  }
  if (proof.localOnly.length > 0) {
    lines.push('', `${plural(proof.localOnly.length, 'chat')} ${proof.localOnly.length === 1 ? 'is' : 'are'} held locally but no longer on the server.`);
  }
  return lines.join('\n');
}
