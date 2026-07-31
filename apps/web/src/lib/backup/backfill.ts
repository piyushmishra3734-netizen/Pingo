/**
 * Walking each conversation back to its beginning, so the archive has something
 * complete to snapshot.
 *
 * The archive builder is unchanged and stays a snapshot of local storage. This
 * is the stage that makes local storage worth snapshotting: it pages the server
 * oldest-first and persists what it finds, so a two-year account stops producing
 * a two-week backup.
 *
 * Everything is injected — the source, the sink, the cursor store — because the
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

export interface BackfillSink {
  write(conversationId: string, rows: BackfillRow[]): Promise<void>;
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
    readonly code: 'not-advancing' | 'out-of-order' | 'cancelled' | 'source-failed',
    readonly conversationId?: string,
  ) {
    super(message);
    this.name = 'BackfillError';
  }
}

export interface BackfillResult {
  conversationsWalked: number;
  conversationsComplete: number;
  messagesFetched: number;
  /** Conversations that ended the run unfinished, with why. */
  incomplete: Array<{ conversationId: string; reason: string }>;
  cancelled: boolean;
}

const PAGE = 50;

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
): Promise<{ cursor: BackfillCursor; fetched: number }> {
  const stored = await cursors.read(conversationId);
  let cursor: BackfillCursor = isValidCursor(stored) ? stored : { ...EMPTY_CURSOR };

  let fetched = 0;

  /*
   * A hard ceiling on pages per conversation.
   *
   * Every other exit from this loop depends on the server being honest — that a
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
      throw new BackfillError(
        `Stopped after ${MAX_PAGES} pages without reaching the start of history.`,
        'not-advancing',
        conversationId,
      );
    }

    const page = await source.page(conversationId, cursor.oldestFetchedId, pageSize);

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
       * the one that matters — timestamps can legitimately tie.
       */
      if (
        cursor.oldestFetchedId !== undefined &&
        (oldest.id === cursor.oldestFetchedId ||
          (cursor.oldestFetchedAt !== undefined && oldest.created_at > cursor.oldestFetchedAt))
      ) {
        throw new BackfillError(
          'The server returned newer messages than the cursor asked for.',
          'out-of-order',
          conversationId,
        );
      }

      await sink.write(conversationId, page);
      fetched += page.length;
      onPage(page.length);

      cursor = {
        ...cursor,
        oldestFetchedId: oldest.id,
        oldestFetchedAt: oldest.created_at,
        pages: cursor.pages + 1,
        lastRunAt: Date.now(),
      };
      await cursors.write(conversationId, cursor);
    }

    /*
     * The only thing that ends a walk.
     *
     * Asked after every page, including a full one, so a conversation whose
     * length is an exact multiple of the page size still terminates — and asked
     * after a *short* page rather than assuming it meant the end, which is the
     * failure this whole module is shaped around.
     */
    const remaining = await source.countOlderThan(conversationId, cursor.oldestFetchedId);
    if (remaining === 0) {
      cursor = { ...cursor, complete: true, lastRunAt: Date.now() };
      await cursors.write(conversationId, cursor);
      break;
    }

    /*
     * The server says there is more and did not give us any. Retrying would
     * spin forever, so this stops and says which conversation is stuck.
     */
    if (page.length === 0) {
      throw new BackfillError(
        `The server reports ${remaining} older messages but returned none.`,
        'not-advancing',
        conversationId,
      );
    }
  }

  return { cursor, fetched };
}

/**
 * Walk every conversation that is not already finished.
 *
 * Cancellation is cooperative and checked between pages, so stopping leaves the
 * cursors describing exactly what was written — the run is abandoned, never the
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
  } = {},
): Promise<BackfillResult> {
  const signal = options.signal ?? { cancelled: false };
  const pageSize = options.pageSize ?? PAGE;

  const conversations = await source.conversations();
  const incomplete: BackfillResult['incomplete'] = [];

  let messagesFetched = 0;
  let conversationsComplete = 0;
  let conversationsWalked = 0;

  for (const conversationId of conversations) {
    if (signal.cancelled) break;

    const existing = await cursors.read(conversationId);
    if (isValidCursor(existing) && existing.complete) {
      conversationsComplete += 1;
      options.onProgress?.({
        conversationsDone: conversationsWalked + conversationsComplete,
        conversationsTotal: conversations.length,
        messagesFetched,
        conversationId,
      });
      continue;
    }

    try {
      const { cursor, fetched } = await walkConversation(
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
      );

      conversationsWalked += 1;
      if (cursor.complete) conversationsComplete += 1;
      else incomplete.push({ conversationId, reason: signal.cancelled ? 'cancelled' : 'stopped early' });
      void fetched;
    } catch (cause) {
      /*
       * One bad conversation does not abandon the rest. The run continues and
       * reports it, because a single unreachable thread should not cost somebody
       * the backup of everything else — and the completeness proof will refuse
       * to archive anyway while it is short.
       */
      incomplete.push({
        conversationId,
        reason: cause instanceof Error ? cause.message : 'failed',
      });
    }
  }

  return {
    conversationsWalked,
    conversationsComplete,
    messagesFetched,
    incomplete,
    cancelled: signal.cancelled,
  };
}
