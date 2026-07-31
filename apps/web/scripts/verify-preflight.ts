/**
 * Preflight, against a known account and a server that partly fails.
 *
 * Two properties matter more than the arithmetic. The first is that measuring
 * the account never downloads it — a preflight that transferred history to
 * report on history would defeat its purpose. The second is that one failed
 * count degrades a figure rather than the whole summary, because a backup
 * blocked by the video count timing out is a poor trade.
 *
 * Run with `pnpm verify:preflight`.
 */
import {
  ASSUMED_BYTES_PER_MESSAGE,
  estimateArchiveBytes,
  formatBytes,
  formatPreflight,
  runPreflight,
  type LocalSample,
  type PreflightSource,
} from '../src/lib/backup/preflight.js';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
};

/** A known account. Every expected number below is derived from this. */
const FIXTURE = {
  conversations: 412,
  messages: 38_204,
  photos: 2_310,
  videos: 148,
  documents: 86,
  voiceNotes: 431,
  mediaBytes: 1_288_490_188, // 1.2 GB
};

class FakeSource implements PreflightSource {
  calls: string[] = [];
  /** Counts named here throw instead of answering. */
  broken = new Set<string>();

  #count(label: string, value: number) {
    this.calls.push(label);
    if (this.broken.has(label)) return Promise.reject(new Error(`${label} unavailable`));
    return Promise.resolve(value);
  }

  countConversations() {
    return this.#count('conversations', FIXTURE.conversations);
  }
  countMessages() {
    return this.#count('messages', FIXTURE.messages);
  }
  countPhotos() {
    return this.#count('photos', FIXTURE.photos);
  }
  countVideos() {
    return this.#count('videos', FIXTURE.videos);
  }
  countDocuments() {
    return this.#count('documents', FIXTURE.documents);
  }
  countVoiceNotes() {
    return this.#count('voiceNotes', FIXTURE.voiceNotes);
  }
  mediaBytes() {
    return this.#count('mediaBytes', FIXTURE.mediaBytes);
  }
}

/** 4,000 rows averaging exactly 400 bytes — a sample worth trusting. */
const SAMPLE: LocalSample = { rows: 4_000, bytes: 4_000 * 400 };

console.log('— counts match a known fixture —');

{
  const source = new FakeSource();
  const summary = await runPreflight(source, SAMPLE);

  check(summary.conversations === FIXTURE.conversations, `chats (${summary.conversations})`);
  check(summary.messages === FIXTURE.messages, `messages (${summary.messages})`);
  check(summary.photos === FIXTURE.photos, `photos (${summary.photos})`);
  check(summary.videos === FIXTURE.videos, `videos (${summary.videos})`);
  check(summary.documents === FIXTURE.documents, `documents (${summary.documents})`);
  check(summary.voiceNotes === FIXTURE.voiceNotes, `voice notes (${summary.voiceNotes})`);
  check(!summary.partial && summary.unavailable.length === 0, 'nothing reported unavailable');
  check(!summary.empty, 'an account with history is not called empty');
}

console.log('\n— measuring the account does not download it —');

{
  /*
   * The source interface returns numbers, so rows cannot come back through it.
   * This checks the other half: that a preflight is a fixed, small number of
   * requests rather than one per conversation.
   */
  const source = new FakeSource();
  await runPreflight(source, SAMPLE);
  check(source.calls.length === 7, `seven aggregate queries, not one per chat (${source.calls.length})`);
  check(
    new Set(source.calls).size === source.calls.length,
    'and each is asked once',
  );
}

console.log('\n— the estimate is within tolerance —');

{
  const summary = await runPreflight(new FakeSource(), SAMPLE);
  const plaintext = FIXTURE.messages * 400;

  check(
    Math.abs(summary.archive.bytes - plaintext) / plaintext < 0.01,
    `the estimate tracks the measured average (${formatBytes(summary.archive.bytes)} vs ${formatBytes(plaintext)})`,
  );
  check(summary.archive.low < summary.archive.bytes, 'the range has a floor below it');
  check(summary.archive.high > summary.archive.bytes, 'and a ceiling above it');
  check(summary.archive.sampledRows === 4_000, 'the sample size is reported');
  check(!summary.archive.assumed, 'and the average was measured, not assumed');
  check(
    plaintext >= summary.archive.low && plaintext <= summary.archive.high,
    'the true size falls inside the quoted range',
  );
}

{
  // An account of long messages must not be estimated with a short-message
  // average. The measurement is what makes this work; assuming would not.
  const chatty = estimateArchiveBytes(10_000, { rows: 1_000, bytes: 1_000 * 2_400 });
  const terse = estimateArchiveBytes(10_000, { rows: 1_000, bytes: 1_000 * 90 });
  check(chatty.bytes > terse.bytes * 20, 'a verbose account estimates far larger than a terse one');
}

{
  // A thin sample widens the band rather than quoting a confident number
  // derived from eleven messages.
  const thin = estimateArchiveBytes(10_000, { rows: 11, bytes: 11 * 400 });
  const thick = estimateArchiveBytes(10_000, { rows: 4_000, bytes: 4_000 * 400 });
  const spread = (e: { low: number; high: number; bytes: number }) => (e.high - e.low) / e.bytes;
  check(spread(thin) > spread(thick), 'less evidence produces a wider range');
}

console.log('\n— a device with nothing measured yet —');

{
  /*
   * The first backup is exactly this case: a fresh device holding almost no
   * rows and an account of tens of thousands. The estimate has to come from
   * somewhere, and it has to say that it did.
   */
  const summary = await runPreflight(new FakeSource(), { rows: 0, bytes: 0 });
  check(summary.archive.assumed, 'the estimate declares that it assumed an average');
  check(summary.archive.sampledRows === 0, 'and reports no sample');
  check(
    summary.archive.bytes > FIXTURE.messages * ASSUMED_BYTES_PER_MESSAGE * 0.99,
    'the documented default is used',
  );
  check((summary.archive.high - summary.archive.low) / summary.archive.bytes > 1, 'with the widest range');
}

console.log('\n— a zero-history account —');

{
  const source = new FakeSource();
  for (const k of ['conversations', 'messages', 'photos', 'videos', 'documents', 'voiceNotes', 'mediaBytes']) {
    Object.defineProperty(source, `count${k[0]!.toUpperCase()}${k.slice(1)}`, {
      value: () => Promise.resolve(0),
    });
  }
  Object.defineProperty(source, 'mediaBytes', { value: () => Promise.resolve(0) });

  const summary = await runPreflight(source, { rows: 0, bytes: 0 });
  check(summary.empty, 'a new account is reported empty');
  check(!summary.partial, 'and not as a failure');
  check(summary.toDownload === 0, 'with nothing to download');
  check(/Nothing to back up yet/.test(formatPreflight(summary)), 'and is worded as such');
}

console.log('\n— a count query that fails —');

{
  const source = new FakeSource();
  source.broken.add('videos');
  const summary = await runPreflight(source, SAMPLE);

  check(summary.partial, 'the summary is marked partial');
  check(summary.unavailable.includes('videos'), 'the missing figure is named');
  check(summary.messages === FIXTURE.messages, 'every other count survived');
  check(summary.videos === 0, 'and the failed one reads zero');
  check(/Could not measure: videos/.test(formatPreflight(summary)), 'the wording says what is missing');
}

{
  /*
   * The dangerous confusion: an account with no history and an account whose
   * count failed both show zero, and they need opposite words. Congratulating
   * someone on a backup of a history that was never measured is the failure
   * this separates.
   */
  const source = new FakeSource();
  source.broken.add('messages');
  source.broken.add('conversations');
  const summary = await runPreflight(source, SAMPLE);

  check(!summary.empty, 'a failed count is NOT reported as an empty account');
  check(summary.partial, 'it is reported as partial');
  check(!/Nothing to back up yet/.test(formatPreflight(summary)), 'and never worded as nothing to back up');
}

{
  // Everything failing is still a summary, not an exception.
  const source = new FakeSource();
  for (const k of ['conversations', 'messages', 'photos', 'videos', 'documents', 'voiceNotes', 'mediaBytes']) {
    source.broken.add(k);
  }
  const summary = await runPreflight(source, SAMPLE);
  check(summary.partial && summary.unavailable.length === 7, 'a total outage returns a summary, not a throw');
  check(!summary.empty, 'and does not claim the account is empty');
}

console.log('\n— what is left, not what exists —');

{
  const summary = await runPreflight(new FakeSource(), SAMPLE, {
    messages: 30_000,
    conversationsComplete: 380,
  });
  check(summary.toDownload === 8_204, `only the remainder is quoted (${summary.toDownload})`);
  check(/8,204 older messages still to download/.test(formatPreflight(summary)), 'and said in words');
}

{
  // Local exceeding the server is the healthy state after a deletion, not a
  // negative amount of work.
  const summary = await runPreflight(new FakeSource(), SAMPLE, {
    messages: 40_000,
    conversationsComplete: 412,
  });
  check(summary.toDownload === 0, 'local holding more than the server means nothing to download');
}

console.log('\n— media is counted but not promised —');

{
  const summary = await runPreflight(new FakeSource(), SAMPLE);
  const rendered = formatPreflight(summary);

  check(summary.mediaBytes === FIXTURE.mediaBytes, 'media size is reported');
  check(
    summary.archive.bytes < summary.mediaBytes / 10,
    'but is not folded into the archive estimate',
  );
  check(/not included yet/.test(rendered), 'and the wording says it is not included');
  check(/Estimated size/.test(rendered), 'the size line says estimated');
  check(/–/.test(rendered), 'and shows a range rather than a bare number');
}

console.log('\n' + formatPreflight(await runPreflight(new FakeSource(), SAMPLE)) + '\n');

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
