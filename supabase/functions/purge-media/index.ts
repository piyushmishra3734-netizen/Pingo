import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

/**
 * Deletes the media PINGO has finished with, for people who are not here.
 *
 * ## Why this exists as well as the client sweeper
 *
 * Storage policies let nobody but an uploader remove their own objects, which
 * is a property worth keeping - it means no key exists in a browser that could
 * delete somebody else's media. So the ordinary path is the uploader's own
 * client collecting what the database has parked, on their next visit.
 *
 * That leaves one hole, and it is the one that grows: a person who stops using
 * PINGO. Their parked objects have satisfied every rule for deletion and there
 * is nobody to run the delete. This function closes it, with the service role,
 * from the server, on a schedule - and it is the *only* thing here that holds
 * that credential.
 *
 * ## It decides nothing
 *
 * Every rule about what may go lives in `purge_delivered_media()`: delivered to
 * everyone plus the minimum retention, or past the thirty-day ceiling. This
 * function only reads what has already been parked and calls the Storage API.
 * A bug here can fail to delete; it cannot delete something that was not
 * already released, because it never looks at receipts or dates at all.
 *
 * ## The caller must already be trusted
 *
 * Called from inside the database by `pg_cron`, which has no user session, so
 * `verify_jwt` is off and a shared secret is the whole check - the same
 * arrangement `push-send` uses, and for the same reason.
 */

/** Never more than this in one run, so a backlog cannot monopolise a worker. */
const BATCH = 200;

interface ParkedRow {
  id: string;
  media_purge_path: string;
  media_purge_bucket: string;
}

/** Constant time, so a wrong secret cannot be found one character at a time. */
function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (request: Request) => {
  const expected = Deno.env.get('MEDIA_SWEEPER_SECRET');
  if (!expected) {
    console.error('[purge-media] MEDIA_SWEEPER_SECRET is not set');
    return new Response('not configured', { status: 500 });
  }

  const offered = request.headers.get('x-pingo-sweeper-secret') ?? '';
  if (!sameSecret(offered, expected)) return new Response('forbidden', { status: 403 });

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  /*
   * Parked, and not yet collected by anybody. The uploader's own client may
   * get there first - that is the common case and costs nothing here, because
   * a row it has confirmed no longer matches.
   */
  const { data, error } = await admin
    .from('messages')
    .select('id, media_purge_path, media_purge_bucket')
    .not('media_purge_path', 'is', null)
    .is('media_purged_at', null)
    .limit(BATCH);

  if (error) {
    console.error('[purge-media] could not read parked media', error.message);
    return new Response('read failed', { status: 500 });
  }

  const rows = (data ?? []) as ParkedRow[];
  let deleted = 0;
  let missing = 0;

  for (const row of rows) {
    if (!row.media_purge_path || !row.media_purge_bucket) continue;

    const { error: removeError } = await admin.storage
      .from(row.media_purge_bucket)
      .remove([row.media_purge_path]);

    /*
     * An object that has already gone is a success. The alternative is a row
     * that is retried every hour for ever because the first attempt half
     * worked, which is the exact shape of an idempotency bug.
     */
    if (removeError && !/not\s*found/i.test(removeError.message)) {
      console.error('[purge-media] delete failed', row.media_purge_path, removeError.message);
      continue;
    }
    if (removeError) missing += 1;

    /*
     * The pointer, last. Clearing it before the object is gone is how bytes
     * become unnameable - see `20260918000000_media_lifecycle`, which exists
     * partly because that happened to Pings.
     */
    const { error: clearError } = await admin
      .from('messages')
      .update({
        media_purged_at: new Date().toISOString(),
        media_purge_path: null,
        media_url: null,
        /*
         * All three, because a message carries at most one of them - which is
         * how it is written and what the parked path was taken from. Matching
         * the exact column would need the row's current values, and the guard
         * below is the stronger check anyway: the update only applies if the
         * parked path is still the one this run deleted.
         */
        photo_path: null,
        file_path: null,
        voice_path: null,
      })
      .eq('id', row.id)
      .eq('media_purge_path', row.media_purge_path);

    if (clearError) {
      console.error('[purge-media] could not clear pointer', row.id, clearError.message);
      continue;
    }
    deleted += 1;
  }

  return Response.json({ considered: rows.length, deleted, alreadyGone: missing });
});
