/**
 * Walking each conversation back to its beginning, so the archive has something
 * complete to snapshot.
 *
 * The archive builder is unchanged and stays a snapshot of local storage. This
 * is the stage that makes local storage worth snapshotting: it pages the server
 * oldest-first and persists what it finds, so a two-year account stops producing
 * a two-week backup.
 *
 * Everything is injected - the source, the sink, the cursor store - because the
 * interesting failures here are a hostile or confused server, and those are
 * reproducible only when the server is something the test controls.
 *
 * ## The short page is the dangerous case
 *
 * `chat-service.ts:318` records that a page can come back short without history
 * having ended: the hidden-message filter runs after the database limit, and
 * `MAX_PAGE_READS` bounds the refill. If backfill treated short as terminal, it
 * would stop early, the archive would be silently incomplete, and it would still
 * verify and restore perfectly. So the end of history is *confirmed with a
 * count*, never inferred from a page length.
 *
 * ## Completion is arithmetic, not a feeling
 *
 * A walk ends with an audit record that says what was expected, what arrived,
 * and whether those agree - see `BackfillAudit`. "It finished without throwing"
 * is not evidence, and this module is built on the assumption that the server
 * may be wrong.
 */

/** The minimum a row needs for paging. The sink stores whatever else it likes. */
export interface BackfillRow {
  id: string;
  created_at: string;
}

export interface BackfillCursor {
  /** Oldest message this device has walked back to, exclusive. */
  oldestFetchedId?: string;
  oldestFetchedAt?: string;
  /** Set only when the server has confirmed there is nothing older. */
  complete: boolean;
  lastRunAt?: number;
  /** Pages walked, for progress and for spotting a loop that is not advancing. */
  pages: number;

  /*
   * Audit state, carried in the cursor rather than in memory.
   *
   * A backfill that spans days and half a dozen interrupted runs must still be
   * able to explain itself at the end. An audit that resets on resume would be
   * blank for exactly the long, flaky runs it exists to debug.
   */

  /**
   * Newest message at the moment the walk began.
   *
   * This anchors every later count. Without it, messages arriving during a long
   * backfill inflate the expected total, and a walk that fetched everything it
   * set out to fetch looks short - a false alarm on the most ordinary event
   * there is, someone sending a message while the backup runs.
   */
  anchorId?: string;
  /** Messages the server claimed, in the anchored range, when the walk began. */
  expected?: number;
  /** Rows the sink reported as new. */
  downloaded?: number;
  /** Rows the server sent that the sink already held. */
  duplicates?: number;
  /** Pages re-requested after a failure. */
  retries?: number;
  /** Time spent walking, summed across runs - not wall-clock since the start. */
  elapsedMs?: number;
  startedAt?: number;
}

export const EMPTY_CURSOR: BackfillCursor = { complete: false, pages: 0 };

/**
 * A cursor that does not describe a walk is treated as no cursor.
 *
 * A corrupted record must restart a conversation, not crash the run and not be
 * trusted. Restarting costs bandwidth; trusting it would silently skip history.
 */
export function isValidCursor(value: unknown): value is BackfillCursor {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Partial<BackfillCursor>;
  if (typeof c.complete !== 'boolean') return false;
  if (typeof c.pages !== 'number' || !Number.isFinite(c.pages) || c.pages < 0) return false;
  if (c.oldestFetchedId !== undefined && typeof c.oldestFetchedId !== 'string') return false;
  if (c.oldestFetchedAt !== undefined && typeof c.oldestFetchedAt !== 'string') return false;
  if (c.anchorId !== undefined && typeof c.anchorId !== 'string') return false;
  for (const n of [c.expected, c.downloaded, c.duplicates, c.retries, c.elapsedMs] as const) {
    if (n !== undefined && (typeof n !== 'number' || !Number.isFinite(n) || n < 0)) return false;
  }
  return true;
}

export interface BackfillSource {
  /** Every conversation this account can read. */
  conversations(): Promise<string[]>;
  /** One page strictly older than `before`, newest-first within the page. */
  page(conversationId: string, before: string | undefined, limit: number): Promise<BackfillRow[]>;
  /**
   * How many messages the server still holds older than `before`.
   *
   * This is what ends a walk. A page length cannot.
   */
  countOlderThan(conversationId: string, before: string | undefined): Promise<number>;
}

/**
 * The sink reports how many rows were genuinely new.
 *
 * Needed so the audit can tell 'the server sent this twice' from 'the server
 * sent something we had not seen'. Counting duplicates in the caller would mean
 * holding every id of every conversation in memory, which is the one thing this
 * module is careful not to do.
 */
export interface BackfillSink {
  write(conversationId: string, rows: BackfillRow[]): Promise<number>;
}

export interface CursorStore {
  read(conversationId: string): Promise<unknown>;
  write(conversationId: string, cursor: BackfillCursor): Promise<void>;
}

export interface BackfillProgress {
  conversationsDone: number;
  conversationsTotal: number;
  messagesFetched: number;
  conversationId?: string;
}

export class BackfillError extends Error {
  constructor(
    message: string,
    readonly code: 'not-advancing' | 'out-of-order' | 'cancelled' | 'source-failed' | 'count-mismatch',
    readonly conversationId?: string,
  ) {
    super(message);
    this.name = 'BackfillError';
  }
}

/**
 * Why a walk ended, in the words a support conversation needs.
 *
 * `count-mismatch` is the one that earns this whole type: the server said there
 * was nothing older *and* still claimed more messages than arrived. Both cannot
 * be true, so neither is believed.
 */
export type BackfillVerdict =
  | 'complete'
  | 'count-mismatch'
  | 'stopped-early'
  | 'cancelled'
  | 'failed';

/**
 * What happened to one conversation, in numbers that can be checked.
 *
 * Contains no message content, no text, no sender, no timestamps of individual
 * messages - only counts, and a `ref` that stands in for the conversation id
 * (see `redactAudit`). A user can send this to support without sending their
 * chat history, which is the only version of an audit log worth shipping in an
 * end-to-end encrypted product.
 */
export interface BackfillAudit {
  conversationId: string;
  /** Stable stand-in for the id, so an audit can be shared as-is. */
  ref: string;
  /** Messages the server claimed when the walk began, in the anchored range. */
  expected: number;
  /** The same range, re-counted at the end. Deletions move this; arrivals do not. */
  expectedFinal: number;
  /** Rows the sink reported as new. */
  downloaded: number;
  /** Rows the server sent that were already held. */
  duplicates: number;
  /** `downloaded + duplicates` - everything the server actually handed over. */
  seen: number;
  /** `seen - expectedFinal`. Zero is the expected answer; negative is a shortfall. */
  discrepancy: number;
  pages: number;
  retries: number;
  completed: boolean;
  verdict: BackfillVerdict;
  /** Plain-language observations: a shrinking server, duplicates, a shortfall. */
  notes: string[];
  /** Time spent walking, summed across runs. */
  durationMs: number;
}

export interface BackfillResult {
  conversationsWalked: number;
  conversationsComplete: number;
  messagesFetched: number;
  /** Conversations that ended the run unfinished, with why. */
  incomplete: Array<{ conversationId: string; reason: string }>;
  cancelled: boolean;
  /** One record per conversation touched, including ones already finished. */
  audit: BackfillAudit[];
}

const PAGE = 50;
const MAX_PAGE_RETRIES = 2;

/**
 * A short, stable, non-reversible stand-in for a conversation id.
 *
 * FNV-1a, not a cryptographic hash, and not pretending to be one: the point is
 * that a support ticket can say "the audit for a1b2c3d4" without the id itself
 * travelling, while two audits from the same device still line up.
 */
export function conversationRef(conversationId: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < conversationId.length; i += 1) {
    h ^= conversationId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** An audit with the conversation id removed, for sharing outside the device. */
export function redactAudit(audit: BackfillAudit): Omit<BackfillAudit, 'conversationId'> {
  const { conversationId: _omitted, ...rest } = audit;
  return rest;
}

/**
 * The audit as a fixed-width table.
 *
 * Redacted by default. Someone pasting this into a bug report should not have to
 * notice that the default leaked their conversation ids.
 */
export function formatAuditLog(
  audits: BackfillAudit[],
  options: { redact?: boolean } = {},
): string {
  const redact = options.redact ?? true;
  const idOf = (a: BackfillAudit) => (redact ? a.ref : a.conversationId);
  const rows = audits.map((a) => [
    idOf(a),
    String(a.expected),
    String(a.downloaded),
    String(a.duplicates),
    String(a.retries),
    a.completed ? 'yes' : 'no',
    `${(a.durationMs / 1000).toFixed(1)}s`,
    a.verdict,
  ]);
  const head = ['Conversation', 'Expected', 'Downloaded', 'Duplicates', 'Retried', 'Complete', 'Duration', 'Verdict'];
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join('  ').trimEnd();
  const rule = widths.map((w) => '-'.repeat(w)).join('  ');

  const out = [line(head), rule, ...rows.map(line)];
  const notes = audits.filter((a) => a.notes.length > 0);
  if (notes.length > 0) {
    out.push('');
    for (const a of notes) out.push(`${idOf(a)}: ${a.notes.join('; ')}`);
  }
  return out.join('\n');
}

/**
 * Does the arithmetic agree that this conversation is whole?
 *
 * The protocol confirmation - a count of zero older than the cursor - and this
 * check come from the same endpoint on purpose. A server that is merely wrong
 * usually satisfies one and not the other, so requiring *both* turns a single
 * inconsistent source into a contradiction with itself. Requiring only one, as
 * "downloaded == expected OR the server said so" would, lets whichever answer
 * happens to be wrong carry the decision alone.
 *
 * `>=` rather than `==` because the server may legitimately shrink underneath a
 * running backfill: a message deleted for everyone after it was fetched leaves
 * the device holding more than the server admits to. Holding more is never the
 * failure. Holding less is.
 *
 * The second clause is the one that catches a bad count rather than a bad page.
 * The anchored range is fixed at the newest message the walk started from, so it
 * can only ever *shrink* - deletions remove from it, and arrivals are newer than
 * the anchor and outside it. A range that grew means the count is wrong, and a
 * count that is wrong here is the input to the decision that history has ended.
 *
 * ## What this cannot catch, stated plainly
 *
 * A count endpoint that is wrong *consistently* - reporting a total that agrees
 * with the range that agrees with what was delivered - satisfies every check
 * here, because counts are the only evidence available and all of it comes from
 * one place. The independent check is §9's proof, which compares the local row
 * store against the server afresh before any archive is written.
 */
function reconciles(seen: number, expected: number, expectedFinal: number): boolean {
  return seen >= expectedFinal && expectedFinal <= expected;
}

/**
 * One conversation, walked as far back as it goes.
 *
 * Returns the cursor it reached. Persisting after every page is what makes an
 * interrupted run resumable without a second piece of state to keep in step.
 */
async function walkConversation(
  conversationId: string,
  source: BackfillSource,
  sink: BackfillSink,
  cursors: CursorStore,
  signal: { cancelled: boolean },
  onPage: (fetched: number) => void,
  pageSize: number,
  delay: (ms: number) => Promise<void>,
): Promise<{ cursor: BackfillCursor; fetched: number; expectedFinal?: number }> {
  const stored = await cursors.read(conversationId);
  let cursor: BackfillCursor = isValidCursor(stored) ? stored : { ...EMPTY_CURSOR };

  const runStarted = Date.now();
  let fetched = 0;
  /* The anchored re-count, kept so the audit reports what the walk measured
   * rather than assuming its own arithmetic was right. */
  let expectedFinal: number | undefined;

  /*
   * The anchored expectation, taken once and then carried.
   *
   * Asked before the first page so it describes the account as the walk found
   * it. On resume the stored figure is reused - re-asking would fold every
   * message sent since into the total and make a finished walk look short.
   */
  if (cursor.expected === undefined) {
    cursor = {
      ...cursor,
      expected: await source.countOlderThan(conversationId, undefined),
      downloaded: 0,
      duplicates: 0,
      retries: 0,
      elapsedMs: 0,
      startedAt: runStarted,
    };
    await cursors.write(conversationId, cursor);
  }

  const commitElapsed = async () => {
    cursor = {
      ...cursor,
      elapsedMs: (cursor.elapsedMs ?? 0) + (Date.now() - runStarted),
      lastRunAt: Date.now(),
    };
    await cursors.write(conversationId, cursor);
  };

  /*
   * A hard ceiling on pages per conversation.
   *
   * Every other exit from this loop depends on the server being honest - that a
   * page advances, or that a count eventually reaches zero. A server that is
   * wrong in the right way can satisfy both forever, and the first version of
   * this loop did exactly that against a stalling stand-in: it hung the suite
   * rather than failing it.
   *
   * Fifty thousand pages is far past any real conversation and still finite,
   * which is the property that matters. Reaching it is a bug in the server or
   * here, and is reported as one rather than spun on.
   */
  const MAX_PAGES = 50_000;
  let iterations = 0;

  while (!cursor.complete) {
    if (signal.cancelled) break;

    if (iterations++ >= MAX_PAGES) {
      await commitElapsed();
      throw new BackfillError(
        `Stopped after ${MAX_PAGES} pages without reaching the start of history.`,
        'not-advancing',
        conversationId,
      );
    }

    /*
     * A page is retried before the conversation is abandoned.
     *
     * A backfill of a large account is minutes of network, so a single dropped
     * request is an ordinary event rather than a reason to fail a thread and
     * make the user press the button again. Retries are counted, because a run
     * that succeeded on the third attempt every time is a different story from
     * one that succeeded first time, and only the audit can tell them apart.
     */
    let page: BackfillRow[];
    for (let attempt = 0; ; attempt += 1) {
      try {
        page = await source.page(conversationId, cursor.oldestFetchedId, pageSize);
        break;
      } catch (cause) {
        if (attempt >= MAX_PAGE_RETRIES || signal.cancelled) {
          await commitElapsed();
          throw cause;
        }
        cursor = { ...cursor, retries: (cursor.retries ?? 0) + 1 };
        await cursors.write(conversationId, cursor);
        await delay(200 * (attempt + 1));
      }
    }

    if (page.length > 0) {
      /*
       * The server must hand back messages older than where we are. A page that
       * repeats or moves forward means the cursor and the server disagree, and
       * continuing would either loop forever or skip history.
       */
      const oldest = page[page.length - 1]!;

      /*
       * Two ways the server can fail to move us backwards, and both must be
       * caught. A page whose oldest row is *newer* than the cursor is plainly
       * out of order; a page whose oldest row is the same one we already have
       * looks fine on timestamps and never terminates. The identity check is
       * the one that matters - timestamps can legitimately tie.
       */
      if (
        cursor.oldestFetchedId !== undefined &&
        (oldest.id === cursor.oldestFetchedId ||
          (cursor.oldestFetchedAt !== undefined && oldest.created_at > cursor.oldestFetchedAt))
      ) {
        await commitElapsed();
        throw new BackfillError(
          'The server returned newer messages than the cursor asked for.',
          'out-of-order',
          conversationId,
        );
      }

      const written = await sink.write(conversationId, page);
      fetched += page.length;
      onPage(page.length);

      cursor = {
        ...cursor,
        // Set once, from the newest row of the first page - the anchor every
        // later count is measured against.
        anchorId: cursor.anchorId ?? page[0]!.id,
        oldestFetchedId: oldest.id,
        oldestFetchedAt: oldest.created_at,
        pages: cursor.pages + 1,
        downloaded: (cursor.downloaded ?? 0) + written,
        duplicates: (cursor.duplicates ?? 0) + (page.length - written),
        lastRunAt: Date.now(),
      };
      await cursors.write(conversationId, cursor);
    }

    /*
     * The only thing that ends a walk.
     *
     * Asked after every page, including a full one, so a conversation whose
     * length is an exact multiple of the page size still terminates - and asked
     * after a *short* page rather than assuming it meant the end, which is the
     * failure this whole module is shaped around.
     */
    const remaining = await source.countOlderThan(conversationId, cursor.oldestFetchedId);
    if (remaining === 0) {
      /*
       * The protocol says done. Now check whether the numbers agree.
       *
       * Re-counted against the anchor rather than against nothing, so messages
       * that arrived during the walk are excluded - they are newer than where
       * this walk started and belong to delta sync, not here.
       */
      expectedFinal =
        cursor.anchorId === undefined
          ? 0
          : (await source.countOlderThan(conversationId, cursor.anchorId)) + 1;
      const seen = (cursor.downloaded ?? 0) + (cursor.duplicates ?? 0);

      if (!reconciles(seen, cursor.expected ?? 0, expectedFinal)) {
        await commitElapsed();
        throw new BackfillError(
          `The server reported no more history but counts ${expectedFinal} messages ` +
            `in a range that held ${cursor.expected ?? 0}, of which ${seen} arrived.`,
          'count-mismatch',
          conversationId,
        );
      }

      cursor = { ...cursor, complete: true };
      await commitElapsed();
      break;
    }

    /*
     * The server says there is more and did not give us any. Retrying would
     * spin forever, so this stops and says which conversation is stuck.
     */
    if (page.length === 0) {
      await commitElapsed();
      throw new BackfillError(
        `The server reports ${remaining} older messages but returned none.`,
        'not-advancing',
        conversationId,
      );
    }
  }

  if (!cursor.complete) await commitElapsed();
  return { cursor, fetched, expectedFinal };
}

/**
 * Build the audit record for one conversation from the cursor it reached.
 *
 * `expectedFinal` is passed in rather than re-counted: the walk already asked,
 * and asking again would be a second network round trip for a number that may
 * have moved in between.
 */
function auditFor(
  conversationId: string,
  cursor: BackfillCursor,
  expectedFinal: number,
  verdict: BackfillVerdict,
): BackfillAudit {
  const downloaded = cursor.downloaded ?? 0;
  const duplicates = cursor.duplicates ?? 0;
  const seen = downloaded + duplicates;
  const expected = cursor.expected ?? 0;
  const notes: string[] = [];

  if (duplicates > 0) notes.push(`${duplicates} rows arrived that were already held`);
  if (expectedFinal < expected) {
    notes.push(`the server shrank by ${expected - expectedFinal} during the walk`);
  }
  if (expectedFinal > expected) {
    notes.push(`the server grew by ${expectedFinal - expected} within the anchored range`);
  }
  if (seen < expectedFinal) notes.push(`${expectedFinal - seen} messages were never delivered`);
  if ((cursor.retries ?? 0) > 0) notes.push(`${cursor.retries} pages were retried`);

  return {
    conversationId,
    ref: conversationRef(conversationId),
    expected,
    expectedFinal,
    downloaded,
    duplicates,
    seen,
    discrepancy: seen - expectedFinal,
    pages: cursor.pages,
    retries: cursor.retries ?? 0,
    completed: cursor.complete,
    verdict,
    notes,
    durationMs: cursor.elapsedMs ?? 0,
  };
}

/**
 * Walk every conversation that is not already finished.
 *
 * Cancellation is cooperative and checked between pages, so stopping leaves the
 * cursors describing exactly what was written - the run is abandoned, never the
 * progress.
 */
export async function runBackfill(
  source: BackfillSource,
  sink: BackfillSink,
  cursors: CursorStore,
  options: {
    signal?: { cancelled: boolean };
    onProgress?: (progress: BackfillProgress) => void;
    pageSize?: number;
    /** Injected so tests do not sleep through retry backoff. */
    delay?: (ms: number) => Promise<void>;
  } = {},
): Promise<BackfillResult> {
  const signal = options.signal ?? { cancelled: false };
  const pageSize = options.pageSize ?? PAGE;
  const delay = options.delay ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const conversations = await source.conversations();
  const incomplete: BackfillResult['incomplete'] = [];
  const audit: BackfillAudit[] = [];

  let messagesFetched = 0;
  let conversationsComplete = 0;
  let conversationsWalked = 0;

  for (const conversationId of conversations) {
    if (signal.cancelled) break;

    const existing = await cursors.read(conversationId);
    if (isValidCursor(existing) && existing.complete) {
      conversationsComplete += 1;
      /*
       * An already-finished conversation still gets a row.
       *
       * An audit that only lists what this run touched cannot answer "is my
       * backup complete", which is the question it is for. The numbers come
       * from the stored cursor, so this costs no requests.
       */
      audit.push(auditFor(conversationId, existing, existing.expected ?? 0, 'complete'));
      options.onProgress?.({
        conversationsDone: conversationsWalked + conversationsComplete,
        conversationsTotal: conversations.length,
        messagesFetched,
        conversationId,
      });
      continue;
    }

    try {
      const { cursor, fetched, expectedFinal } = await walkConversation(
        conversationId,
        source,
        sink,
        cursors,
        signal,
        (n) => {
          messagesFetched += n;
          options.onProgress?.({
            conversationsDone: conversationsWalked + conversationsComplete,
            conversationsTotal: conversations.length,
            messagesFetched,
            conversationId,
          });
        },
        pageSize,
        delay,
      );

      conversationsWalked += 1;
      if (cursor.complete) {
        conversationsComplete += 1;
        audit.push(auditFor(conversationId, cursor, expectedFinal ?? cursor.expected ?? 0, 'complete'));
      } else {
        const reason = signal.cancelled ? 'cancelled' : 'stopped early';
        incomplete.push({ conversationId, reason });
        audit.push(
          auditFor(conversationId, cursor, cursor.expected ?? 0, signal.cancelled ? 'cancelled' : 'stopped-early'),
        );
      }
      void fetched;
    } catch (cause) {
      /*
       * One bad conversation does not abandon the rest. The run continues and
       * reports it, because a single unreachable thread should not cost somebody
       * the backup of everything else - and the completeness proof will refuse
       * to archive anyway while it is short.
       */
      const reason = cause instanceof Error ? cause.message : 'failed';
      incomplete.push({ conversationId, reason });

      const reached = await cursors.read(conversationId);
      const cursor = isValidCursor(reached) ? reached : { ...EMPTY_CURSOR };
      const verdict: BackfillVerdict =
        cause instanceof BackfillError && cause.code === 'count-mismatch' ? 'count-mismatch' : 'failed';
      const record = auditFor(conversationId, cursor, cursor.expected ?? 0, verdict);
      record.notes.push(reason);
      audit.push(record);
    }
  }

  return {
    conversationsWalked,
    conversationsComplete,
    messagesFetched,
    incomplete,
    cancelled: signal.cancelled,
    audit,
  };
}
