/**
 * The completeness proof, including the case it exists to catch.
 *
 * The backfill audit states its own limit: every figure in it comes from one
 * endpoint, so a count that is wrong consistently satisfies all of it. This is
 * the independent check, so the tests that matter are the ones where the two
 * sources disagree — and the one where a global total balances perfectly while
 * individual conversations are wrong in opposite directions.
 *
 * Run with `pnpm verify:completeness`.
 */
import {
  CompletenessError,
  completenessHeader,
  conversationsToWalk,
  formatProof,
  proveCompleteness,
  type CursorReader,
  type LocalCounts,
  type ProofSource,
} from '../src/lib/backup/completeness.js';
import {
  runBackfill,
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

/** Server counts, local counts and cursors, each independently riggable. */
function world(spec: Record<string, { server: number; local: number; walked: boolean; unreadable?: number }>) {
  const ids = Object.keys(spec);
  const broken = new Set<string>();
  let peakInFlight = 0;
  let inFlight = 0;

  const source: ProofSource = {
    async conversations() {
      return ids;
    },
    async countMessages(id) {
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      if (broken.has(id)) throw new Error('count unavailable');
      return spec[id]!.server;
    },
  };

  const local: LocalCounts = {
    async conversations() {
      return ids;
    },
    async countMessages(id) {
      return spec[id]!.local;
    },
  };

  const cursors: CursorReader = {
    async read(id) {
      return { complete: spec[id]!.walked, pages: 1, unreadable: spec[id]!.unreadable ?? 0 };
    },
  };

  return { source, local, cursors, broken, ids, peak: () => peakInFlight };
}

console.log('— a proven account —');

{
  const w = world({
    a: { server: 120, local: 120, walked: true },
    b: { server: 3_400, local: 3_400, walked: true },
    c: { server: 0, local: 0, walked: true },
  });
  const proof = await proveCompleteness(w.source, w.local, w.cursors);

  check(proof.status === 'proven', 'the account is proven');
  check(proof.unreadable === 0, 'with nothing unreadable');
  check(proof.shortfall.conversations === 0, 'nothing is short');
  check(proof.totals.localMessages === 3_520, `the totals add up (${proof.totals.localMessages})`);
  check(proof.conversations.every((c) => c.status === 'proven'), 'every conversation is proven');
  check(/Complete: 3,520 messages across 3 chats/.test(formatProof(proof)), 'and is worded plainly');
}

console.log('\n— short by one —');

{
  const w = world({
    a: { server: 120, local: 119, walked: true },
    b: { server: 3_400, local: 3_400, walked: true },
  });
  const proof = await proveCompleteness(w.source, w.local, w.cursors);

  check(proof.status === 'short', 'one missing message fails the proof');
  check(proof.shortfall.messages === 1, 'and the shortfall is exactly one');
  check(proof.conversations[0]!.status === 'short', 'the conversation is named short');
  check(/^1 message on the server is not held locally$/.test(proof.conversations[0]!.reason ?? ''), 'with a reason');
}

console.log('\n— short in one conversation only —');

{
  const w = world({
    a: { server: 500, local: 500, walked: true },
    b: { server: 500, local: 120, walked: true },
    c: { server: 500, local: 500, walked: true },
  });
  const proof = await proveCompleteness(w.source, w.local, w.cursors);

  check(proof.status === 'short', 'one bad conversation fails the account');
  check(proof.shortfall.conversations === 1, 'exactly one is short');
  check(proof.shortfall.messages === 380, `and by 380 (${proof.shortfall.messages})`);
  check(conversationsToWalk(proof).length === 1, 'a retry would walk only that one');
  check(conversationsToWalk(proof)[0] === 'b', 'and it is the right one');
}

console.log('\n— the case a global total would hide —');

{
  /*
   * The aggregate balances perfectly: 1,000 on the server, 1,000 held locally.
   * One conversation holds 400 extra after a deletion; another is missing 400.
   * Summing first and comparing would call this account complete.
   */
  const w = world({
    a: { server: 500, local: 900, walked: true },
    b: { server: 500, local: 100, walked: true },
  });
  const proof = await proveCompleteness(w.source, w.local, w.cursors);

  check(
    proof.totals.serverMessages === proof.totals.localMessages,
    `the totals match exactly (${proof.totals.localMessages})`,
  );
  check(proof.status === 'short', 'and the account is still NOT proven');
  check(proof.shortfall.messages === 400, 'the real shortfall is found');
  check(conversationsToWalk(proof)[0] === 'b', 'in the conversation that is actually short');
}

console.log('\n— local exceeding the server is not a failure —');

{
  /*
   * Messages deleted for everyone after this device stored them, or history the
   * server has expired. The device holding the only remaining copy is the
   * feature, not a defect.
   */
  const w = world({
    a: { server: 10, local: 4_000, walked: true },
    b: { server: 500, local: 500, walked: true },
  });
  const proof = await proveCompleteness(w.source, w.local, w.cursors);

  check(proof.status === 'proven', 'holding more than the server still proves');
  check(proof.conversations[0]!.difference === 3_990, `the surplus is reported (${proof.conversations[0]!.difference})`);
  check(proof.shortfall.messages === 0, 'and counts as no shortfall');
}

console.log('\n— a cursor that never finished —');

{
  /*
   * Counts alone would pass this: local holds everything the server admits to.
   * The cursor says the walk never reached the beginning, which is exactly the
   * lie the backfill audit cannot see on its own — a server under-reporting its
   * own history agrees with itself.
   */
  const w = world({ a: { server: 120, local: 120, walked: false } });
  const proof = await proveCompleteness(w.source, w.local, w.cursors);

  check(proof.status === 'short', 'matching counts do not prove an unwalked conversation');
  check(proof.conversations[0]!.status === 'not-walked', 'it is reported as not walked');
  check(proof.conversations[0]!.difference === 0, 'even though the counts agree exactly');
}

console.log('\n— a count that could not be read —');

{
  const w = world({
    a: { server: 120, local: 120, walked: true },
    b: { server: 500, local: 500, walked: true },
  });
  w.broken.add('b');
  const proof = await proveCompleteness(w.source, w.local, w.cursors);

  check(proof.status === 'unverified', 'an unreadable count leaves the account unverified');
  check(proof.status !== 'proven', 'and never proven');
  check(proof.conversations[1]!.status === 'unmeasured', 'the conversation is unmeasured, not short');
  check(proof.shortfall.messages === 0, 'it is not counted as missing history');
  check(proof.conversations[0]!.status === 'proven', 'the other conversation is still measured');
  check(/Could not verify 1 of 2/.test(formatProof(proof)), 'and the wording says so, not "missing"');
}

{
  // A known shortfall outranks an unknown one: the actionable fact leads.
  const w = world({
    a: { server: 500, local: 100, walked: true },
    b: { server: 500, local: 500, walked: true },
  });
  w.broken.add('b');
  const proof = await proveCompleteness(w.source, w.local, w.cursors);
  check(proof.status === 'short', 'a proven shortfall outranks an unmeasured chat');
  check(conversationsToWalk(proof).length === 2, 'and a retry covers both');
}

console.log('\n— chats the server no longer has —');

{
  const w = world({ a: { server: 500, local: 500, walked: true } });
  const local: LocalCounts = {
    async conversations() {
      return ['a', 'gone-1', 'gone-2'];
    },
    countMessages: w.local.countMessages,
  };
  const proof = await proveCompleteness(w.source, local, w.cursors);

  check(proof.status === 'proven', 'history the server dropped does not block the proof');
  check(proof.localOnly.length === 2, 'the local-only chats are reported');
  check(/2 chats are held locally but no longer on the server/.test(formatProof(proof)), 'and explained');
  check(!/1 messages|1 chats /.test(formatProof(proof)), 'nothing reads "1 messages"');
}

console.log('\n— the header cannot claim what was not proven —');

{
  const proven = await proveCompleteness(
    ...(() => {
      const w = world({ a: { server: 120, local: 120, walked: true } });
      return [w.source, w.local, w.cursors] as const;
    })(),
  );
  const header = completenessHeader(proven);
  check(header.messages === 120 && header.conversations === 1, 'a proven account produces a header');
  check(typeof header.provenAt === 'number', 'stamped with when it was proven');

  for (const [label, spec] of [
    ['short', { a: { server: 120, local: 1, walked: true } }],
    ['unwalked', { a: { server: 120, local: 120, walked: false } }],
  ] as const) {
    const w = world(spec);
    const proof = await proveCompleteness(w.source, w.local, w.cursors);
    let threw = false;
    try {
      completenessHeader(proof);
    } catch (cause) {
      threw = cause instanceof CompletenessError && cause.code === 'not-proven';
    }
    check(threw, `a ${label} account cannot produce a header`);
  }

  const w = world({ a: { server: 120, local: 120, walked: true } });
  w.broken.add('a');
  const unverified = await proveCompleteness(w.source, w.local, w.cursors);
  let threw = false;
  try {
    completenessHeader(unverified);
  } catch (cause) {
    threw = cause instanceof CompletenessError;
  }
  check(threw, 'nor can an unverified one');
}

console.log('\n— four hundred chats do not become four hundred simultaneous requests —');

{
  const spec: Record<string, { server: number; local: number; walked: boolean }> = {};
  for (let i = 0; i < 400; i += 1) spec[`c${i}`] = { server: 10, local: 10, walked: true };
  const w = world(spec);

  const proof = await proveCompleteness(w.source, w.local, w.cursors, { concurrency: 8 });
  check(proof.status === 'proven', 'a large account proves');
  check(proof.conversations.length === 400, 'every conversation is measured');
  check(w.peak() <= 8, `at most eight counts are in flight (peak ${w.peak()})`);
}

console.log('\n— a retry resumes rather than restarting —');

{
  /*
   * End to end across both modules: backfill walks, the proof finds what the
   * walk did not finish, and a targeted retry completes only that. The point is
   * that the second run does not re-page a conversation that already succeeded.
   */
  const history = (id: string, n: number): BackfillRow[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `${id}-m${String(n - i).padStart(5, '0')}`,
      created_at: new Date(1_700_000_000_000 + (n - i) * 1000).toISOString(),
    }));

  const store = new Map([
    ['a', history('a', 120)],
    ['b', history('b', 120)],
  ]);
  let failB = true;

  const backfillSource: BackfillSource = {
    async conversations() {
      return [...store.keys()];
    },
    async page(id, before, limit) {
      if (id === 'b' && failB) throw new Error('network');
      const all = store.get(id)!;
      const i = before ? all.findIndex((r) => r.id === before) : -1;
      return all.slice(i + 1, i + 1 + limit);
    },
    async countOlderThan(id, before) {
      const all = store.get(id)!;
      const i = before ? all.findIndex((r) => r.id === before) : -1;
      return all.length - (i + 1);
    },
  };

  const rows = new Map<string, Set<string>>();
  const sink: BackfillSink = {
    async write(id, page) {
      const bucket = rows.get(id) ?? new Set<string>();
      let written = 0;
      for (const r of page) {
        if (!bucket.has(r.id)) written += 1;
        bucket.add(r.id);
      }
      rows.set(id, bucket);
      return { written, unreadable: 0 };
    },
  };

  const held = new Map<string, unknown>();
  const cursorStore: CursorStore = {
    async read(id) {
      return held.get(id);
    },
    async write(id, cursor) {
      held.set(id, cursor);
    },
  };

  await runBackfill(backfillSource, sink, cursorStore, { pageSize: 50, delay: async () => {} });

  const proofSource: ProofSource = {
    async conversations() {
      return [...store.keys()];
    },
    async countMessages(id) {
      return store.get(id)!.length;
    },
  };
  const localCounts: LocalCounts = {
    async conversations() {
      return [...rows.keys()];
    },
    async countMessages(id) {
      return rows.get(id)?.size ?? 0;
    },
  };

  const first = await proveCompleteness(proofSource, localCounts, cursorStore);
  check(first.status === 'short', 'the proof catches the conversation backfill could not finish');
  check(conversationsToWalk(first).join() === 'b', 'and names only that one');

  // The retry: the server recovers, and only the short conversation is walked.
  failB = false;
  const pagesBefore = { a: 0 };
  const countingSource: BackfillSource = {
    ...backfillSource,
    async conversations() {
      return conversationsToWalk(first);
    },
    async page(id, before, limit) {
      if (id === 'a') pagesBefore.a += 1;
      return backfillSource.page(id, before, limit);
    },
  };
  await runBackfill(countingSource, sink, cursorStore, { pageSize: 50, delay: async () => {} });

  const second = await proveCompleteness(proofSource, localCounts, cursorStore);
  check(second.status === 'proven', 'after the retry the account is proven');
  check(pagesBefore.a === 0, 'the conversation that already succeeded was never re-paged');
  check(rows.get('b')!.size === 120, `and the short one is now whole (${rows.get('b')!.size})`);
  check(completenessHeader(second).messages === 240, 'the header can finally be written');
}

console.log('\n— the proof is safe to send to support —');

{
  const w = world({
    'conversation-uuid-aaaa': { server: 500, local: 100, walked: true },
  });
  const proof = await proveCompleteness(w.source, w.local, w.cursors);
  const rendered = formatProof(proof);

  check(!rendered.includes('conversation-uuid-aaaa'), 'the rendered proof redacts ids by default');
  check(rendered.includes(proof.conversations[0]!.ref), 'and carries a stable ref instead');
  check(/100 of 500/.test(rendered), 'with the numbers a bug report needs');
  console.log('\n' + rendered + '\n');
}

console.log('\n— what the device cannot read is not a shortfall —');

{
  /*
   * Measured on a real account: 296 messages that predate this device cannot be
   * decrypted by it, so the sink refuses to store them rather than writing the
   * "Sent before you added this device." placeholder into the archive. Counting
   * them as missing blocked every backup of the 5,463 readable ones, for ever,
   * because no retry can ever make them readable.
   */
  const w = world({ a: { server: 5759, local: 5463, walked: true, unreadable: 296 } });
  const proof = await proveCompleteness(w.source, w.local, w.cursors);

  check(proof.status === 'proven', 'an account short only by unreadable rows still proves');
  check(proof.unreadable === 296, `and the count is carried (${proof.unreadable})`);
  check(proof.shortfall.messages === 0, 'none of it is reported as missing history');
  check(/cannot be read on this device/.test(formatProof(proof)), 'the wording says so plainly');
  check(completenessHeader(proof).messages === 5463, 'the header claims only what was stored');
}

{
  // A real shortfall alongside unreadable rows is still a shortfall.
  const w = world({ a: { server: 5759, local: 5000, walked: true, unreadable: 296 } });
  const proof = await proveCompleteness(w.source, w.local, w.cursors);
  check(proof.status === 'short', 'a genuine gap still blocks');
  check(proof.shortfall.messages === 463, `and counts only the recoverable part (${proof.shortfall.messages})`);
}

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
