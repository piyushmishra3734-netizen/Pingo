/**
 * Backfill, against a server that misbehaves on purpose.
 *
 * The happy path is the least interesting thing here. What matters is that a
 * server which returns a short page, repeats itself, stalls, or disagrees with
 * its own count cannot convince backfill that history has ended — because an
 * archive built on that belief verifies perfectly and is silently incomplete.
 *
 * Run with `pnpm verify:backfill`.
 */
import {
  BackfillError,
  EMPTY_CURSOR,
  isValidCursor,
  runBackfill,
  type BackfillCursor,
  type BackfillRow,
  type BackfillSink,
  type BackfillSource,
  type CursorStore,
} from '../src/lib/backup/backfill.js';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
};

/** A conversation of `n` messages, newest first, as the server would hold it. */
function history(conversationId: string, n: number): BackfillRow[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${conversationId}-m${String(n - i).padStart(5, '0')}`,
    created_at: new Date(1_700_000_000_000 + (n - i) * 1000).toISOString(),
  }));
}

/** A server that can be told to behave badly in specific, realistic ways. */
class FakeServer implements BackfillSource {
  pageCalls = 0;
  countCalls = 0;
  /** Return this many fewer rows than asked, once. */
  shortPageOnce = false;
  /** Return the same page forever. */
  repeatForever = false;
  /** Return nothing while claiming more exists. */
  stall = false;
  /** Throw on the next page call. */
  failNextPage = false;
  /** Claim this many older messages regardless of truth. */
  lieAboutRemaining?: number;

  constructor(private readonly store: Map<string, BackfillRow[]>) {}

  async conversations() {
    return [...this.store.keys()];
  }

  #older(conversationId: string, before: string | undefined): BackfillRow[] {
    const all = this.store.get(conversationId) ?? [];
    if (!before) return all;
    const i = all.findIndex((r) => r.id === before);
    return i < 0 ? all : all.slice(i + 1);
  }

  async page(conversationId: string, before: string | undefined, limit: number) {
    this.pageCalls += 1;
    if (this.failNextPage) {
      this.failNextPage = false;
      throw new Error('network');
    }
    if (this.stall) return [];
    if (this.repeatForever) return (this.store.get(conversationId) ?? []).slice(0, limit);

    const older = this.#older(conversationId, before);
    if (this.shortPageOnce && older.length > 1) {
      this.shortPageOnce = false;
      // A short page that is NOT the end — exactly what MAX_PAGE_READS can cause.
      return older.slice(0, 1);
    }
    return older.slice(0, limit);
  }

  async countOlderThan(conversationId: string, before: string | undefined) {
    this.countCalls += 1;
    if (this.lieAboutRemaining !== undefined) return this.lieAboutRemaining;
    return this.#older(conversationId, before).length;
  }
}

class MemorySink implements BackfillSink {
  rows = new Map<string, Map<string, BackfillRow>>();
  async write(conversationId: string, rows: BackfillRow[]) {
    const bucket = this.rows.get(conversationId) ?? new Map<string, BackfillRow>();
    for (const r of rows) bucket.set(r.id, r); // keyed, so duplicates collapse
    this.rows.set(conversationId, bucket);
  }
  count(conversationId: string) {
    return this.rows.get(conversationId)?.size ?? 0;
  }
}

function memoryCursors(seed: Record<string, unknown> = {}): CursorStore & {
  peek: (id: string) => unknown;
  writes: number;
} {
  const held = new Map<string, unknown>(Object.entries(seed));
  let writes = 0;
  return {
    async read(id) {
      return held.get(id);
    },
    async write(id, cursor) {
      writes += 1;
      held.set(id, cursor);
    },
    peek: (id) => held.get(id),
    get writes() {
      return writes;
    },
  };
}

const CONV = 'c1';

console.log('— happy path —');

{
  const server = new FakeServer(new Map([[CONV, history(CONV, 120)]]));
  const sink = new MemorySink();
  const cursors = memoryCursors();
  const result = await runBackfill(server, sink, cursors, { pageSize: 50 });

  check(result.messagesFetched === 120, `all 120 messages fetched (${result.messagesFetched})`);
  check(sink.count(CONV) === 120, 'all 120 stored');
  check(result.conversationsComplete === 1, 'the conversation is marked complete');
  check(result.incomplete.length === 0, 'nothing reported incomplete');
  check((cursors.peek(CONV) as BackfillCursor).complete === true, 'the cursor records completeness');
}

console.log('\n— the short-page attack —');

{
  /*
   * The server hands back one row when fifty were asked for, then continues
   * normally. A backfill that reads short as "end of history" stops at 1 of 120
   * and the archive is silently missing 119 messages.
   */
  const server = new FakeServer(new Map([[CONV, history(CONV, 120)]]));
  server.shortPageOnce = true;
  const sink = new MemorySink();
  const result = await runBackfill(server, sink, memoryCursors(), { pageSize: 50 });

  check(result.messagesFetched === 120, `a short page did not end the walk (${result.messagesFetched} of 120)`);
  check(sink.count(CONV) === 120, 'every message still arrived');
  check(server.countCalls > 0, 'the end was confirmed by count, not inferred from length');
}

console.log('\n— exact multiple of the page size —');

{
  const server = new FakeServer(new Map([[CONV, history(CONV, 100)]]));
  const sink = new MemorySink();
  const result = await runBackfill(server, sink, memoryCursors(), { pageSize: 50 });
  check(result.messagesFetched === 100, 'a full final page still terminates');
  check(result.conversationsComplete === 1, 'and is marked complete');
}

console.log('\n— interruption and resume —');

{
  const full = history(CONV, 120);
  const server = new FakeServer(new Map([[CONV, full]]));
  const sink = new MemorySink();
  const cursors = memoryCursors();

  server.failNextPage = true;
  const first = await runBackfill(server, sink, cursors, { pageSize: 50 });
  check(first.incomplete.length === 1, 'a network failure is reported, not thrown');
  check(sink.count(CONV) === 0, 'nothing was stored from the failed page');

  const second = await runBackfill(server, sink, cursors, { pageSize: 50 });
  check(second.messagesFetched === 120, 'the retry fetches everything');
  check(sink.count(CONV) === 120, 'and the conversation is whole');
}

{
  const server = new FakeServer(new Map([[CONV, history(CONV, 200)]]));
  const sink = new MemorySink();
  const cursors = memoryCursors();
  const signal = { cancelled: false };

  // Cancel after the first page lands.
  const run = runBackfill(server, sink, cursors, {
    pageSize: 50,
    signal,
    onProgress: () => {
      signal.cancelled = true;
    },
  });
  const result = await run;

  check(result.cancelled, 'cancellation is reported');
  check(sink.count(CONV) > 0 && sink.count(CONV) < 200, `stopped partway (${sink.count(CONV)} of 200)`);

  signal.cancelled = false;
  const resumed = await runBackfill(server, sink, cursors, { pageSize: 50 });
  check(sink.count(CONV) === 200, 'resuming completes it without re-fetching from zero');
  check(resumed.messagesFetched < 200, `only the remainder was fetched (${resumed.messagesFetched})`);
}

console.log('\n— duplicate pages —');

{
  const server = new FakeServer(new Map([[CONV, history(CONV, 30)]]));
  const sink = new MemorySink();
  await runBackfill(server, sink, memoryCursors(), { pageSize: 50 });
  await runBackfill(server, sink, memoryCursors(), { pageSize: 50 });
  check(sink.count(CONV) === 30, 'walking twice stores 30, not 60');
}

console.log('\n— a server that will not advance —');

{
  const server = new FakeServer(new Map([[CONV, history(CONV, 30)]]));
  server.stall = true;
  server.lieAboutRemaining = 30; // claims more, returns none
  const sink = new MemorySink();
  const result = await runBackfill(server, sink, memoryCursors(), { pageSize: 50 });

  check(result.incomplete.length === 1, 'the stall is reported rather than looped on');
  check(/returned none/.test(result.incomplete[0]!.reason), `and says why: "${result.incomplete[0]!.reason}"`);
}

console.log('\n— a server that repeats itself —');

{
  const server = new FakeServer(new Map([[CONV, history(CONV, 120)]]));
  server.repeatForever = true;
  const sink = new MemorySink();
  const result = await runBackfill(server, sink, memoryCursors(), { pageSize: 50 });
  check(result.incomplete.length === 1, 'repeated pages are caught');
  check(/newer messages/.test(result.incomplete[0]!.reason), 'and reported as out of order');
}

console.log('\n— a corrupted cursor —');

{
  const server = new FakeServer(new Map([[CONV, history(CONV, 60)]]));
  const sink = new MemorySink();
  const cursors = memoryCursors({ [CONV]: { complete: 'yes', pages: -1 } });

  check(!isValidCursor({ complete: 'yes', pages: -1 }), 'a malformed cursor is rejected');
  check(isValidCursor(EMPTY_CURSOR), 'and a well-formed one is accepted');

  const result = await runBackfill(server, sink, cursors, { pageSize: 50 });
  check(result.messagesFetched === 60, 'a corrupted cursor restarts the walk rather than skipping it');
  check(sink.count(CONV) === 60, 'and the conversation is complete afterwards');
}

console.log('\n— completed conversations are never paged again —');

{
  const server = new FakeServer(new Map([[CONV, history(CONV, 60)]]));
  const sink = new MemorySink();
  const cursors = memoryCursors();
  await runBackfill(server, sink, cursors, { pageSize: 50 });

  const before = server.pageCalls;
  const again = await runBackfill(server, sink, cursors, { pageSize: 50 });
  check(server.pageCalls === before, 'a second run makes no page requests');
  check(again.conversationsComplete === 1, 'and still reports it complete');
  check(again.messagesFetched === 0, 'fetching nothing, which is what makes later backups cheap');
}

console.log('\n— one bad conversation does not lose the others —');

{
  const server = new FakeServer(
    new Map([
      ['good-1', history('good-1', 30)],
      ['bad', history('bad', 30)],
      ['good-2', history('good-2', 30)],
    ]),
  );
  const sink = new MemorySink();

  const realPage = server.page.bind(server);
  server.page = async (id, before, limit) => {
    if (id === 'bad') throw new Error('unreachable');
    return realPage(id, before, limit);
  };

  const result = await runBackfill(server, sink, memoryCursors(), { pageSize: 50 });
  check(sink.count('good-1') === 30 && sink.count('good-2') === 30, 'the healthy conversations complete');
  check(result.incomplete.length === 1 && result.incomplete[0]!.conversationId === 'bad', 'the bad one is named');
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
