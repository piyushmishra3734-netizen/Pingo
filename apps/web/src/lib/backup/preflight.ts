/**
 * What a backup is about to cost, answered before it starts.
 *
 * Step two of complete-history backup. Backfill can download a two-year account
 * over a phone connection, so the user gets to see the size of that before it
 * begins rather than discovering it as a progress bar that will not end.
 *
 * ## Nothing here transfers history
 *
 * Every figure comes from an aggregate count - `Prefer: count=exact` with
 * `Range: 0-0`, which returns a header and no rows. The source interface is
 * shaped so that it *cannot* return rows: the methods return `number`. A
 * preflight that downloaded the account to measure the account would be worse
 * than no preflight, and making it structurally impossible is cheaper than
 * remembering not to.
 *
 * ## The estimate is an estimate
 *
 * It is returned as a range and labelled as one. A single number presented as
 * exact and then missed by a third is worse than a range that contains the
 * answer - the user makes the same decision either way, and only one of the two
 * survives being wrong.
 */

/** Counts that come straight from the server, each independently fallible. */
export interface PreflightSource {
  countConversations(): Promise<number>;
  countMessages(): Promise<number>;
  countPhotos(): Promise<number>;
  countVideos(): Promise<number>;
  countDocuments(): Promise<number>;
  countVoiceNotes(): Promise<number>;
  /** Sum of `file_size`. Reported for context; not part of the v1 archive. */
  mediaBytes(): Promise<number>;
}

/**
 * A measurement of how large this account's rows actually serialise.
 *
 * Taken from the local store rather than assumed, because message size varies
 * enormously between an account of one-word replies and one of pasted logs, and
 * the device already holds the evidence.
 */
export interface LocalSample {
  /** Rows measured. Zero is normal on a device that has never backed up. */
  rows: number;
  /** Their total serialised size, as the archive would write them. */
  bytes: number;
}

/**
 * Messages already held locally, so the summary can quote what is *left*.
 *
 * A user who backed up yesterday should not be told they are about to download
 * their entire history again.
 */
export interface LocalProgress {
  messages: number;
  conversationsComplete: number;
}

export interface SizeEstimate {
  /** The figure to show. */
  bytes: number;
  /** The range it is trusted within, from how much evidence there was. */
  low: number;
  high: number;
  /** Rows the average was measured from. Zero means the default was used. */
  sampledRows: number;
  /** True when no local rows existed and a documented default was assumed. */
  assumed: boolean;
}

export interface PreflightSummary {
  conversations: number;
  messages: number;
  photos: number;
  videos: number;
  documents: number;
  voiceNotes: number;
  /**
   * Estimated size of the encrypted archive - messages only.
   *
   * Deliberately not the same field as `mediaBytes`. The archive does not
   * contain media in v1, and a summary that added them together would quote a
   * number for something PINGO is not going to upload.
   */
  archive: SizeEstimate;
  /** Bytes of media on the server. Shown for context, marked as not included. */
  mediaBytes: number;
  /** Messages still to download. Zero when backfill has already finished. */
  toDownload: number;
  /** No history at all - a new account, not a failed measurement. */
  empty: boolean;
  /** One or more counts failed; the rest are still usable. */
  partial: boolean;
  /** Which figures could not be measured, in words. */
  unavailable: string[];
  measuredAt: number;
}

/**
 * Bytes per message when there is nothing to measure.
 *
 * From the archive measurements: 10,000 messages serialised to 3.6 MB. Used
 * only on a device with an empty row store - which is exactly the first backup,
 * so it is the most likely path rather than a corner.
 */
export const ASSUMED_BYTES_PER_MESSAGE = 360;

/** Chunk size the archive builder seals at. */
const CHUNK_BYTES = 1024 * 1024;
/** AES-GCM tag plus IV per chunk, and the manifest entry that describes it. */
const PER_CHUNK_OVERHEAD = 16 + 12 + 120;

/**
 * How far the estimate is trusted, given how many rows it was measured from.
 *
 * Widening the band on a thin sample is the honest move: the alternative is
 * quoting a confident number derived from eleven messages.
 */
function toleranceFor(sampledRows: number): number {
  if (sampledRows >= 200) return 0.2;
  if (sampledRows >= 20) return 0.4;
  return 0.6;
}

/**
 * Estimate the encrypted archive size for `messages` messages.
 *
 * Exported so the suite can check the arithmetic without standing up a source.
 */
export function estimateArchiveBytes(messages: number, sample: LocalSample): SizeEstimate {
  const assumed = sample.rows <= 0;
  const perMessage = assumed ? ASSUMED_BYTES_PER_MESSAGE : sample.bytes / sample.rows;

  const plaintext = Math.round(messages * perMessage);
  const chunks = plaintext === 0 ? 1 : Math.ceil(plaintext / CHUNK_BYTES);
  const bytes = plaintext + chunks * PER_CHUNK_OVERHEAD;

  const tolerance = toleranceFor(assumed ? 0 : sample.rows);
  return {
    bytes,
    low: Math.round(bytes * (1 - tolerance)),
    high: Math.round(bytes * (1 + tolerance)),
    sampledRows: assumed ? 0 : sample.rows,
    assumed,
  };
}

/**
 * Run one count, and treat its failure as a missing figure rather than a
 * failed preflight.
 *
 * A backup that cannot start because the *video* count timed out would be a
 * poor trade. The field falls back to zero and is named in `unavailable`, so
 * the UI can show what it knows and say what it does not - which is also why
 * `partial` exists rather than the caller inferring it from a zero.
 */
async function counted(
  label: string,
  run: () => Promise<number>,
  unavailable: string[],
): Promise<number> {
  try {
    const n = await run();
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    unavailable.push(label);
    return 0;
  }
}

/**
 * Measure the account without downloading it.
 *
 * The counts run concurrently - they are independent, and a preflight that
 * takes six round trips in sequence is a visible pause before a button that has
 * not done anything yet.
 */
export async function runPreflight(
  source: PreflightSource,
  sample: LocalSample,
  local: LocalProgress = { messages: 0, conversationsComplete: 0 },
): Promise<PreflightSummary> {
  const unavailable: string[] = [];

  const [conversations, messages, photos, videos, documents, voiceNotes, mediaBytes] =
    await Promise.all([
      counted('chats', () => source.countConversations(), unavailable),
      counted('messages', () => source.countMessages(), unavailable),
      counted('photos', () => source.countPhotos(), unavailable),
      counted('videos', () => source.countVideos(), unavailable),
      counted('documents', () => source.countDocuments(), unavailable),
      counted('voice notes', () => source.countVoiceNotes(), unavailable),
      counted('media size', () => source.mediaBytes(), unavailable),
    ]);

  /*
   * What is left, not what exists.
   *
   * Clamped at zero because local can legitimately exceed the server - a
   * message deleted for everyone after this device stored it, or history the
   * server has since expired. A negative "still to download" would be nonsense
   * shown to a user whose backup is in the best possible state.
   */
  const toDownload = Math.max(0, messages - local.messages);

  /*
   * Empty means empty, not unmeasured.
   *
   * A new account and an account whose message count failed both show zero, and
   * they need opposite words: one is "nothing to back up yet", the other is
   * "we could not tell". Requiring the count to have succeeded keeps the UI
   * from congratulating someone on a backup of a history it never saw.
   */
  const empty =
    conversations === 0 && messages === 0 && !unavailable.includes('messages') && !unavailable.includes('chats');

  return {
    conversations,
    messages,
    photos,
    videos,
    documents,
    voiceNotes,
    archive: estimateArchiveBytes(messages, sample),
    mediaBytes,
    toDownload,
    empty,
    partial: unavailable.length > 0,
    unavailable,
    measuredAt: Date.now(),
  };
}

/** Bytes as a person would read them. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/**
 * The "Ready to Back Up" summary, as text.
 *
 * The size line says *estimated* and gives the range, every time. There is no
 * option to render it as a bare number, because the one place that would get
 * used is the one place it would mislead.
 */
export function formatPreflight(summary: PreflightSummary): string {
  if (summary.empty) return 'Ready to Back Up\n  Nothing to back up yet.';

  const rows: Array<[string, string]> = [
    ['Chats', summary.conversations.toLocaleString()],
    ['Messages', summary.messages.toLocaleString()],
  ];
  if (summary.photos > 0) rows.push(['Photos', summary.photos.toLocaleString()]);
  if (summary.videos > 0) rows.push(['Videos', summary.videos.toLocaleString()]);
  if (summary.documents > 0) rows.push(['Documents', summary.documents.toLocaleString()]);
  if (summary.voiceNotes > 0) rows.push(['Voice notes', summary.voiceNotes.toLocaleString()]);

  rows.push([
    'Estimated size',
    `${formatBytes(summary.archive.bytes)} (${formatBytes(summary.archive.low)}-${formatBytes(summary.archive.high)})`,
  ]);

  const width = Math.max(...rows.map(([label]) => label.length));
  const out = ['Ready to Back Up', ...rows.map(([l, v]) => `  ${l.padEnd(width)}  ${v}`)];

  if (summary.mediaBytes > 0) {
    out.push(`  ${'Media'.padEnd(width)}  ${formatBytes(summary.mediaBytes)} (not included yet)`);
  }
  if (summary.toDownload > 0 && summary.toDownload < summary.messages) {
    out.push('', `${summary.toDownload.toLocaleString()} older messages still to download.`);
  }
  if (summary.partial) {
    out.push('', `Could not measure: ${summary.unavailable.join(', ')}.`);
  }
  return out.join('\n');
}
