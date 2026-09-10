/**
 * Reaching history that was wrapped to a key which no longer exists.
 *
 * ## What happened, so the repair reads as a repair
 *
 * Every message carries a `recovery:<uid>` wrap made to this account's key. On
 * 2026-09-09 a first-run mint replaced that key: a package from the old opt-in
 * Secure Backup has no `unlock_secret`, so the client could not open it, fell
 * through to `mint()`, and `upsert_account_key` overwrote it because the
 * version had not moved. The public half every earlier wrap was made to went
 * with it.
 *
 * The ciphertext is untouched and none of it is lost - the account's own
 * devices still hold wraps they can open. What is broken is only the path a
 * *new* device takes, which is the account key, and which now opens nothing
 * sent before that morning.
 *
 * ## What this does
 *
 * On a device that can still read the history, for each message: unwrap the
 * content key with this device's key, wrap that same content key to the current
 * account public key, and store the new wrap. The body is never decrypted - a
 * wrap is enough, because the content key is what opens the ciphertext and the
 * plaintext is not needed to re-address it.
 *
 * The content key's bytes never leave `rewrapContentKey`. What this module
 * handles, and the only thing it sends, is already encrypted to a public key.
 *
 * ## Where the wraps go
 *
 * Beside the message, in `message_account_wraps`, not into `envelope->'keys'`.
 * Writing them into the envelope would have updated 36,753 rows, and
 * `messages_touch_updated_at` feeds the delta-sync cursor - eighteen people
 * across twenty-one conversations would have re-downloaded 136 MB of messages
 * that had not changed. The migration of the same name records the measurement.
 */

import { keysArePair, rewrapContentKey } from './envelope.js';
import { deviceIdentity } from './keys.js';
import { accountKey } from './account-key.js';
import type { PingoSupabaseClient } from '../supabase/client.js';

/** What one pass did. Every count is of messages, not of requests. */
export interface BackfillReport {
  /** Candidates the server offered - messages this device can open. */
  scanned: number;
  /** Wraps stored. */
  added: number;
  /** Already had a wrap. A second run reports every message here. */
  skipped: number;
  /** Refused server-side: not this caller's conversation. Expected to be zero. */
  denied: number;
  /** This device holds a wrap the server offered, but it would not open. */
  unreadable: number;
  /** True when the server ran out of candidates rather than the batch cap. */
  complete: boolean;
  /** Where to resume. Undefined once complete. */
  cursor?: string;
  batches: number;
}

export interface BackfillOptions {
  /** Messages per round trip. The server caps this at 250. */
  batch?: number;
  /** Stop after this many batches. The whole point of the first careful runs. */
  maxBatches?: number;
  /** Resume here instead of from the stored cursor. */
  after?: string;
  /**
   * Do everything except store the wraps.
   *
   * Proves the read path, the crypto and the cursor without writing a row -
   * which is what makes it safe to point at production before anyone has
   * agreed to a migration.
   */
  dryRun?: boolean;
  onProgress?: (report: BackfillReport) => void;
}

const CURSOR = 'pingo:account-backfill-cursor';

function readCursor(userId: string): string | undefined {
  try {
    return localStorage.getItem(`${CURSOR}:${userId}`) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeCursor(userId: string, id: string | undefined): void {
  try {
    if (id) localStorage.setItem(`${CURSOR}:${userId}`, id);
    else localStorage.removeItem(`${CURSOR}:${userId}`);
  } catch {
    /* A lost cursor costs a re-scan, not correctness: the server's own
       "no wrap yet" filter is what decides, and it cannot be fooled by a
       cursor that starts too early. */
  }
}

/**
 * One pass. Resumable, idempotent, and safe to run twice.
 *
 * Returns rather than throws for every ordinary refusal - no account key yet,
 * no package, a key that does not match - because the caller is a screen and
 * the honest answer is a report saying nothing was done.
 */
export async function backfillAccountWraps(
  client: PingoSupabaseClient,
  options: BackfillOptions = {},
): Promise<BackfillReport> {
  const batch = Math.min(Math.max(options.batch ?? 250, 1), 250);
  const maxBatches = options.maxBatches ?? Infinity;

  const report: BackfillReport = {
    scanned: 0,
    added: 0,
    skipped: 0,
    denied: 0,
    unreadable: 0,
    complete: false,
    batches: 0,
  };

  const { deviceId, keyPair } = await deviceIdentity();

  const ours = await accountKey(client);
  if (!ours) return report;

  const { data: session } = await client.auth.getUser();
  const userId = session.user?.id;
  if (!userId) return report;

  const { data: pkg, error: pkgError } = await client
    .from('recovery_packages')
    .select('public_key')
    .eq('user_id', userId)
    .maybeSingle();
  if (pkgError || !pkg?.public_key) return report;

  /*
   * Refuse the whole pass unless the key this device holds is demonstrably the
   * other half of the key senders wrap to. Without this a mismatch would be
   * discovered only after every wrap had been made to a public key nobody can
   * open - and they would all have to be deleted and remade.
   */
  const target = pkg.public_key;
  if (!(await keysArePair(ours, target))) return report;

  let cursor = options.after ?? readCursor(userId);

  while (report.batches < maxBatches) {
    const { data: candidates, error } = await client.rpc('account_wrap_candidates', {
      my_device: deviceId,
      after_id: cursor ?? null,
      batch,
    });
    if (error) break;

    const rows = candidates ?? [];
    report.batches += 1;
    report.scanned += rows.length;

    if (rows.length === 0) {
      report.complete = true;
      cursor = undefined;
      break;
    }

    const wraps: { id: string; iv: string; key: string; epk: string }[] = [];
    for (const row of rows) {
      if (!row.wrap) continue;
      try {
        const made = await rewrapContentKey(row.wrap, row.epk, keyPair.privateKey, target);
        wraps.push({ id: row.id, ...made });
      } catch {
        /*
         * This device is named in the envelope but cannot open its own wrap.
         * Counted rather than thrown: one damaged message must not stop the
         * other 36,752, and the cursor still moves past it so a retry does not
         * stall here forever.
         */
        report.unreadable += 1;
      }
    }

    if (!options.dryRun && wraps.length > 0) {
      const { data: stored, error: storeError } = await client.rpc('attach_account_wraps', {
        wraps,
      });
      // The cursor is deliberately not advanced: a failed batch is retried
      // whole, and `on conflict do nothing` makes that free.
      if (storeError) break;

      for (const row of stored ?? []) {
        if (row.status === 'added') report.added += 1;
        else if (row.status === 'skipped') report.skipped += 1;
        else report.denied += 1;
      }
    }

    cursor = rows[rows.length - 1]?.id;
    if (!options.dryRun) writeCursor(userId, cursor);
    options.onProgress?.({ ...report, cursor });

    if (rows.length < batch) {
      report.complete = true;
      cursor = undefined;
      if (!options.dryRun) writeCursor(userId, undefined);
      break;
    }
  }

  report.cursor = cursor;
  return report;
}
