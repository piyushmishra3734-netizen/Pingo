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
  conversationRef,
  formatAuditLog,
  isValidCursor,
  redactAudit,
  runBackfill,
  type BackfillAudit,
  type BackfillCursor,
  type BackfillRow,
  type BackfillSink,
  type BackfillSource,
  type CursorStore,
} from '../src/lib/backup/backfill.js';

/** Retry backoff is real time; tests do not spend it. */
const noDelay = async () => {};

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
  /** Throw on the next N page calls. */
  failPages = 0;
  /** Claim this many older messages regardless of truth. */
  lieAboutRemaining?: number;
  /** Rewrite any count before returning it — for servers whose counts are wrong. */
  countHook?: (before: string | undefined, truth: number) => number;
  /** Run after each page is served, to change history mid-walk. */
  afterPage?: (calls: number) => void;
  /** Serve this page instead of the truthful one, once. */
  injectPageOnce?: BackfillRow[];

  constructor(readonly store: Map<string, BackfillRow[]>) {}

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
    if (this.failPages > 0) {
      this.failPages -= 1;
      throw new Error('network');
    }
    if (this.injectPageOnce) {
      const page = this.injectPageOnce;
      this.injectPageOnce = undefined;
      return page;
    }
    if (this.stall) return [];
    if (this.repeatForever) return (this.store.get(conversationId) ?? []).slice(0, limit);

    const older = this.#older(conversationId, before);
    let page: BackfillRow[];
    if (this.shortPageOnce && older.length > 1) {
      this.shortPageOnce = false;
      // A short page that is NOT the end — exactly what MAX_PAGE_READS can cause.
      page = older.slice(0, 1);
    } else {
      page = older.slice(0, limit);
    }
    this.afterPage?.(this.pageCalls);
    return page;
  }

  async countOlderThan(conversationId: string, before: string | undefined) {
    this.countCalls += 1;
    if (this.lieAboutRemaining !== undefined) return this.lieAboutRemaining;
    const truth = this.#older(conversationId, before).length;
    return this.countHook ? this.countHook(before, truth) : truth;
  }
}

class MemorySink implements BackfillSink {
  rows = new Map<string, Map<string, BackfillRow>>();
  /** Returns how many rows were new, which is what the audit counts. */
  async write(conversationId: string, rows: BackfillRow[]) {
    const bucket = this.rows.get(conversationId) ?? new Map<string, BackfillRow>();
    let written = 0;
    for (const r of rows) {
      if (!bucket.has(r.id)) written += 1;
      bucket.set(r.id, r); // keyed, so duplicates collapse
    }
    this.rows.set(conversationId, bucket);
    return written;
  }
  count(conversationId: string) {
    return this.rows.get(conversationId)?.size ?? 0;
  }
}

/** The audit row for one conversation, since every assertion below wants it. */
const auditOf = (audits: BackfillAudit[], id: string) => audits.find((a) => a.conversationId === id)!;

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

  /*
   * A single dropped request is an ordinary event during minutes of network,
   * and is retried rather than costing the conversation.
   */
  server.failPages = 1;
  const first = await runBackfill(server, sink, cursors, { pageSize: 50, delay: noDelay });
  check(first.incomplete.length === 0, 'a transient network failure is retried, not reported');
  check(sink.count(CONV) === 120, 'and the conversation still completes');
  check(auditOf(first.audit, CONV).retries === 1, 'the retry is counted in the audit');
}

{
  // Retries are bounded. A server that is simply down is reported.
  const server = new FakeServer(new Map([[CONV, history(CONV, 120)]]));
  const sink = new MemorySink();
  const cursors = memoryCursors();

  // Exactly enough to exhaust the retry budget for one page, and no more, so
  // the second run meets a server that has recovered.
  server.failPages = 3;
  const first = await runBackfill(server, sink, cursors, { pageSize: 50, delay: noDelay });
  check(first.incomplete.length === 1, 'a sustained failure is reported, not thrown');
  check(sink.count(CONV) === 0, 'nothing was stored from the failed pages');
  check(auditOf(first.audit, CONV).verdict === 'failed', 'and the audit says it failed');

  const second = await runBackfill(server, sink, cursors, { pageSize: 50, delay: noDelay });
  check(second.messagesFetched === 120, 'a later run fetches everything');
  check(sink.count(CONV) === 120, 'and the conversation is whole');
  check(auditOf(second.audit, CONV).retries === 2, 'retries from the failed run survive the resume (2)');
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

console.log('\n— the audit explains why the store is believed complete —');

{
  const server = new FakeServer(new Map([[CONV, history(CONV, 120)]]));
  const sink = new MemorySink();
  const result = await runBackfill(server, sink, memoryCursors(), { pageSize: 50 });
  const a = auditOf(result.audit, CONV);

  check(a.expected === 120, `expected is recorded (${a.expected})`);
  check(a.downloaded === 120, `downloaded is recorded (${a.downloaded})`);
  check(a.seen === a.expectedFinal, 'seen equals what the server still counts');
  check(a.discrepancy === 0, 'the discrepancy is zero');
  check(a.completed && a.verdict === 'complete', 'the verdict is complete');
  check(a.pages === 3, `pages are counted (${a.pages})`);
  check(a.notes.length === 0, 'a clean walk needs no notes');
}

{
  // Every conversation gets a row, including ones finished on an earlier run —
  // otherwise the audit cannot answer "is my whole account complete".
  const server = new FakeServer(new Map([[CONV, history(CONV, 30)]]));
  const sink = new MemorySink();
  const cursors = memoryCursors();
  await runBackfill(server, sink, cursors, { pageSize: 50 });
  const again = await runBackfill(server, sink, cursors, { pageSize: 50 });
  check(again.audit.length === 1, 'an already-finished conversation still appears');
  check(again.audit[0]!.completed, 'and is still reported complete');
}

console.log('\n— an incorrect server count cannot pass as complete —');

{
  /*
   * The realistic shape of this bug: the range-filtered count is wrong while
   * the total stays honest. The server says nothing is older than the cursor
   * after one page, which would end the walk at 50 of 120 and produce an
   * archive that verifies perfectly and is missing 70 messages.
   */
  const full = history(CONV, 120);
  const server = new FakeServer(new Map([[CONV, full]]));
  const newest = full[0]!.id;
  server.countHook = (before, truth) => (before === undefined || before === newest ? truth : 0);

  const sink = new MemorySink();
  const result = await runBackfill(server, sink, memoryCursors(), { pageSize: 50 });
  const a = auditOf(result.audit, CONV);

  check(result.conversationsComplete === 0, 'the conversation is NOT marked complete');
  check(a.verdict === 'count-mismatch', `the verdict names the contradiction (${a.verdict})`);
  check(a.discrepancy === -70, `and the audit quantifies it (${a.discrepancy})`);
  check(/never delivered/.test(a.notes.join(' ')), 'the note says messages were never delivered');
}

{
  // The other direction: a count that under-reports at the start. The anchored
  // range can only shrink, so a range that grew means the count is wrong.
  const server = new FakeServer(new Map([[CONV, history(CONV, 120)]]));
  let first = true;
  server.countHook = (before, truth) => {
    if (before === undefined && first) {
      first = false;
      return 0; // "you have no messages"
    }
    return truth;
  };

  const result = await runBackfill(server, new MemorySink(), memoryCursors(), { pageSize: 50 });
  check(result.conversationsComplete === 0, 'an under-reported total is not believed');
  check(auditOf(result.audit, CONV).verdict === 'count-mismatch', 'and is reported as a count mismatch');
}

console.log('\n— messages arriving during the backfill —');

{
  /*
   * Someone messages you while the backup runs. The walk is anchored to the
   * newest message it started from, so arrivals are outside its range and
   * belong to delta sync. A naive total-vs-downloaded check would call this
   * finished walk short — a false alarm on the most ordinary event there is.
   */
  const full = history(CONV, 120);
  const server = new FakeServer(new Map([[CONV, full]]));
  let arrived = 0;
  server.afterPage = () => {
    if (arrived >= 5) return;
    arrived += 1;
    full.unshift({
      id: `${CONV}-new${arrived}`,
      created_at: new Date(1_800_000_000_000 + arrived * 1000).toISOString(),
    });
  };

  const sink = new MemorySink();
  const result = await runBackfill(server, sink, memoryCursors(), { pageSize: 50 });
  const a = auditOf(result.audit, CONV);

  check(result.conversationsComplete === 1, 'the walk still completes');
  check(a.discrepancy === 0, 'arrivals do not show up as a discrepancy');
  check(a.expectedFinal === a.expected, 'the anchored range is unmoved by new messages');
  check(sink.count(CONV) === 120, `the original 120 were stored (${sink.count(CONV)})`);
}

console.log('\n— messages deleted during the backfill —');

{
  /*
   * Deleted after this device fetched them, so local legitimately holds more
   * than the server admits to. That is the feature, not a defect: it is exactly
   * the state a backup exists to preserve.
   */
  const full = history(CONV, 120);
  const server = new FakeServer(new Map([[CONV, full]]));
  server.afterPage = (calls) => {
    if (calls === 1) full.splice(1, 5); // remove five already-fetched, keep the anchor
  };

  const sink = new MemorySink();
  const result = await runBackfill(server, sink, memoryCursors(), { pageSize: 50 });
  const a = auditOf(result.audit, CONV);

  check(result.conversationsComplete === 1, 'a shrinking server does not fail the walk');
  check(a.discrepancy === 5, `local holding more is reported as a positive difference (${a.discrepancy})`);
  check(/shrank by 5/.test(a.notes.join(' ')), `and explained: "${a.notes.join('; ')}"`);
}

console.log('\n— duplicate message ids —');

{
  const full = history(CONV, 120);
  const server = new FakeServer(new Map([[CONV, full]]));
  // The second page repeats ten rows from the first, with older rows after them
  // so the walk still advances and the out-of-order guard is not what fires.
  server.afterPage = (calls) => {
    if (calls === 1) server.injectPageOnce = [...full.slice(40, 50), ...full.slice(50, 90)];
  };

  const sink = new MemorySink();
  const result = await runBackfill(server, sink, memoryCursors(), { pageSize: 50 });
  const a = auditOf(result.audit, CONV);

  check(sink.count(CONV) === 120, `duplicates collapse in the store (${sink.count(CONV)})`);
  check(a.duplicates === 10, `and are counted separately (${a.duplicates})`);
  check(a.downloaded === 120, `downloaded counts only what was new (${a.downloaded})`);
  check(a.seen === 130, `seen counts everything the server sent (${a.seen})`);
  check(/already held/.test(a.notes.join(' ')), 'the audit notes the repetition');
  check(result.conversationsComplete === 1, 'and the conversation still completes');
}

console.log('\n— the audit is safe to send to support —');

{
  const server = new FakeServer(new Map([[CONV, history(CONV, 120)]]));
  const result = await runBackfill(server, new MemorySink(), memoryCursors(), { pageSize: 50 });
  const a = auditOf(result.audit, CONV);

  const redacted = JSON.stringify(redactAudit(a));
  check(!redacted.includes(CONV), 'a redacted record does not contain the conversation id');
  check(redacted.includes(a.ref), 'but does carry a stable ref');
  check(conversationRef(CONV) === conversationRef(CONV), 'the ref is stable');
  check(conversationRef(CONV) !== conversationRef('c2'), 'and distinguishes conversations');

  const rendered = formatAuditLog(result.audit);
  check(!rendered.includes(CONV), 'the rendered log redacts by default');
  check(/Expected/.test(rendered) && /Downloaded/.test(rendered), 'and has the columns asked for');

  /*
   * The audit is counts and verdicts only. No message id, text, sender or
   * per-message timestamp may reach it — an audit that leaks content is worse
   * than no audit in an end-to-end encrypted product.
   */
  const messageShaped = /m0{0,4}\d+|created_at|body|sender|ciphertext/i;
  check(!messageShaped.test(redacted), 'no message-shaped field appears in the record');
  check(!messageShaped.test(rendered), 'nor in the rendered log');

  console.log('\n' + formatAuditLog(result.audit) + '\n');
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
