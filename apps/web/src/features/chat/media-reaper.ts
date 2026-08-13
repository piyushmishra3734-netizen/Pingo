import type { PingoSupabaseClient } from '../../lib/supabase/client.js';

/**
 * Removing the bytes PINGO no longer needs to hold.
 *
 * ## Why the uploader's own client does this
 *
 * Two facts decide it. Deleting a `storage.objects` row from Postgres hides the
 * file and leaves the bytes in the bucket - an invisible bill - so the removal
 * has to go through the Storage API. And the storage policies let nobody but
 * the uploader delete their own objects, which is a property worth keeping: it
 * means no server-side key exists that could delete anybody's media.
 *
 * So the database decides *what* may go and parks it; this runs on the sender's
 * next visit and does the deleting. A person who never opens the app again
 * leaves their parked objects behind - which is what the thirty-day ceiling and
 * a future service-role sweeper are for, and is still bounded, because nothing
 * new is being parked for them either.
 *
 * ## Two lists, one shape
 *
 *   · parked media - delivered to everyone, or past its lifetime
 *   · abandoned uploads - bytes that never became a message
 *
 * Both are "objects this account uploaded that nothing needs any more", and
 * both are idempotent: an object already gone deletes clean, and the row is
 * cleared either way, so a half-finished run costs one repeat.
 */

/** Rows returned by `pending_media_purges()`. */
interface ParkedMedia {
  message_id: string;
  path: string;
  bucket: string;
}

/** Rows returned by `abandoned_uploads()`. */
interface AbandonedUpload {
  path: string;
  bucket: string;
}

/** Rows returned by `pending_snap_purges()`. */
interface ParkedSnap {
  message_id: string;
  path: string;
}

/**
 * How long after a launch the sweep runs.
 *
 * Not immediately: the first seconds after opening PINGO belong to showing the
 * conversation list, and a handful of storage deletes competing with that is a
 * slower start for no benefit anybody can see.
 */
const START_DELAY_MS = 20_000;

/** And then once an hour, for a session somebody leaves open all day. */
const REPEAT_MS = 60 * 60 * 1000;

let timer: ReturnType<typeof setTimeout> | undefined;
let running = false;

async function removeObject(
  client: PingoSupabaseClient,
  bucket: string,
  path: string,
): Promise<boolean> {
  try {
    const { error } = await client.storage.from(bucket).remove([path]);
    /*
     * An object that is already gone is a success, not a failure. Retrying it
     * for ever because the first run got half way is exactly the loop this
     * has to avoid.
     */
    if (error && !/not\s*found/i.test(error.message)) return false;
    return true;
  } catch {
    return false;
  }
}

/*
 * The generated database types are built from the deployed schema, and these
 * four functions ship in `20260918000000_media_lifecycle`. One cast here
 * rather than five at the call sites; it comes off when the types are
 * regenerated, and the shapes are declared above so nothing is lost.
 */
/**
 * `media_uploads` ships in the same migration, so the generated types have
 * never seen it either. Narrow shapes rather than `any`: only the two calls
 * this module makes are described.
 */
export function uploadClaims(client: PingoSupabaseClient): {
  insert: (row: { path: string; bucket: string; user_id: string }) => PromiseLike<unknown>;
  delete: () => {
    eq: (column: string, value: string) => PromiseLike<unknown>;
    in: (column: string, values: string[]) => PromiseLike<unknown>;
  };
} {
  return (client as unknown as { from: (table: string) => never }).from('media_uploads');
}

function callRpc<T>(
  client: PingoSupabaseClient,
  name: string,
  args?: Record<string, unknown>,
): Promise<{ data: T[] | null; error: unknown }> {
  const rpc = client.rpc as unknown as (
    fn: string,
    params?: Record<string, unknown>,
  ) => Promise<{ data: T[] | null; error: unknown }>;
  return rpc.call(client, name, args);
}

async function sweepOnce(client: PingoSupabaseClient): Promise<void> {
  if (running) return;
  running = true;

  try {
    // -- media the database has released ------------------------------------
    const parked = await callRpc<ParkedMedia>(client, 'pending_media_purges');
    for (const row of (parked.data ?? []) as ParkedMedia[]) {
      if (!row.path || !row.bucket) continue;
      const gone = await removeObject(client, row.bucket, row.path);
      // Only then the pointer. The other order is how an object becomes
      // unnameable - see `20260918000000_media_lifecycle`.
      if (gone) await callRpc(client, 'confirm_media_purged', { target: row.message_id });
    }

    /*
     * Pings, whose collector has existed without a caller since August.
     *
     * `pending_snap_purges` and `snap_purged` were written together in
     * 20260801010000 and nothing ever called either, so every destroyed Ping
     * has left its bytes behind. Same two steps, same order.
     */
    const snaps = await callRpc<ParkedSnap>(client, 'pending_snap_purges');
    const cleared: string[] = [];
    for (const row of (snaps.data ?? []) as ParkedSnap[]) {
      if (!row.path) continue;
      if (await removeObject(client, 'snaps', row.path)) cleared.push(row.message_id);
    }
    if (cleared.length > 0) await callRpc(client, 'snap_purged', { ids: cleared });

    // -- uploads that never became a message --------------------------------
    const abandoned = await callRpc<AbandonedUpload>(client, 'abandoned_uploads');
    for (const row of (abandoned.data ?? []) as AbandonedUpload[]) {
      if (!row.path || !row.bucket) continue;
      const gone = await removeObject(client, row.bucket, row.path);
      if (gone) await uploadClaims(client).delete().eq('path', row.path);
    }
  } catch {
    /*
     * Silent, and it has to be. Nothing here is the user's business: every
     * failure means some bytes stay one more hour, and the next sweep - or the
     * thirty-day ceiling - handles it. Surfacing it would be an error message
     * about somebody else's storage bill.
     */
  } finally {
    running = false;
  }
}

/** Starts the sweeper. Returns its teardown; safe to call more than once. */
export function startMediaReaper(client: PingoSupabaseClient): () => void {
  stopMediaReaper();

  timer = setTimeout(function tick() {
    void sweepOnce(client);
    timer = setTimeout(tick, REPEAT_MS);
  }, START_DELAY_MS);

  return stopMediaReaper;
}

export function stopMediaReaper(): void {
  if (timer) clearTimeout(timer);
  timer = undefined;
}

/** Exposed for the verification script, which runs one sweep and inspects it. */
export const __sweepOnce = sweepOnce;
