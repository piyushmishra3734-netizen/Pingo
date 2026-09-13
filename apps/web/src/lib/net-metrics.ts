/**
 * Aggregate network-efficiency counters. No content, only counts.
 *
 * ## Why this exists
 *
 * Egress work is invisible: a signing call saved, a video not downloaded, a
 * read-mark folded into the next one - none of them render anything. Without
 * counters the only evidence is the Supabase bill, a month late and with no
 * attribution. These numbers answer "did the optimization hold" on the device
 * that did the work, in the session that did it.
 *
 * ## What is deliberately NOT recorded
 *
 * URLs, paths, message ids, user ids, query text, byte contents - anything
 * that could identify who talked to whom about what. Counter names and byte
 * totals only. The snapshot is safe to paste into a bug report.
 */

export interface NetMetricsSnapshot {
  /** Signed URLs served from memory instead of re-signed. */
  signedUrlCacheHits: number;
  /** Signing requests actually sent (batch counts once). */
  signedUrlRequests: number;
  /** Media bytes served from the vault instead of downloaded. */
  vaultBytesSaved: number;
  /** Media bytes downloaded from the network. */
  vaultBytesFetched: number;
  /** Vault reads that found nothing (first sightings). */
  vaultMisses: number;
  /** Read-mark writes folded into a trailing write. */
  readMarksCoalesced: number;
  /** Read-mark writes sent immediately. */
  readMarksSent: number;
}

const counters: NetMetricsSnapshot = {
  signedUrlCacheHits: 0,
  signedUrlRequests: 0,
  vaultBytesSaved: 0,
  vaultBytesFetched: 0,
  vaultMisses: 0,
  readMarksCoalesced: 0,
  readMarksSent: 0,
};

export type NetMetricKey = keyof NetMetricsSnapshot;

/** Adds `by` (default 1) to a counter. Never throws; metrics must not break product code. */
export function recordMetric(key: NetMetricKey, by = 1): void {
  try {
    counters[key] += by;
  } catch {
    // Metrics are advisory. A counter that cannot increment is skipped, not surfaced.
  }
}

/** A copy of the counters as they stand. */
export function snapshotNetMetrics(): NetMetricsSnapshot {
  return { ...counters };
}

declare global {
  // eslint-disable-next-line no-unused-vars
  interface Window {
    /** Read-only access to the counters above, for on-device baseline measurement. */
    __pingoNetMetrics?: () => NetMetricsSnapshot;
  }
}

/*
 * Read-only console hook for real-device baselines (S1-S5).
 *
 * `snapshotNetMetrics()` already returns a copy, so calling this from the
 * console cannot mutate the counters, send network traffic, or touch PII,
 * secrets, or message content. Guarded for non-DOM (test/node) imports.
 */
if (typeof window !== 'undefined') {
  window.__pingoNetMetrics = snapshotNetMetrics;
}
