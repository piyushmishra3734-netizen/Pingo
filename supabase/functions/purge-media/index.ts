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

/**
 * How long an expired story stays readable in its author's archive.
 *
 * A story leaves the feed at `expires_at` - 24 hours after it was posted - and
 * `listArchive()` keeps showing it to its author after that, from the server,
 * with no local copy anywhere. So the archive is exactly as long as the bytes
 * are kept, and this is the number that decides it.
 *
 * Not in SQL with the message retentions because nothing else reads it: the
 * stories pass below is the only consumer, and a second place to look would be
 * a second place to get out of sync.
 */
const STORY_ARCHIVE_MS = 24 * 60 * 60 * 1000;

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

  /*
   * Snaps, which had a collector that could not be relied on.
   *
   * A snap is parked the same way media is - `snap_purge_path` set, bytes still
   * in the bucket - and until now the only thing that ever deleted them was
   * `pending_snap_purges` running in the *uploader's own browser*. That works
   * for somebody who keeps using PINGO and does nothing at all for somebody who
   * does not. Found in production: a snap uploaded on 26 July, opened and
   * parked on 13 August, still sitting in the bucket a week later because the
   * person who sent it had not been back.
   *
   * The whole point of a snap is that it stops existing. "Unless the sender
   * never opens the app again" is not a footnote anybody agreed to, so the
   * service role collects them here on the same ten-minute tick as everything
   * else. The client sweep stays: it is faster when it happens, and this is
   * the floor under it.
   */
  const { data: snapRows, error: snapError } = await admin
    .from('messages')
    .select('id, snap_purge_path')
    .not('snap_purge_path', 'is', null)
    .limit(BATCH);

  if (snapError) console.error('[purge-media] could not read parked snaps', snapError.message);

  let snapsDeleted = 0;

  for (const snap of (snapRows ?? []) as { id: string; snap_purge_path: string }[]) {
    if (!snap.snap_purge_path) continue;

    const { error: removeError } = await admin.storage
      .from('snaps')
      .remove([snap.snap_purge_path]);

    // Already gone is a success, exactly as above.
    if (removeError && !/not\s*found/i.test(removeError.message)) {
      console.error('[purge-media] snap delete failed', snap.snap_purge_path, removeError.message);
      continue;
    }

    /*
     * Pointer last, and only if it is still the path just deleted - the same
     * guard the media pass uses, and for the same reason: the uploader's own
     * client may have got here first.
     */
    const { error: clearError } = await admin
      .from('messages')
      .update({ snap_purge_path: null, snap_path: null })
      .eq('id', snap.id)
      .eq('snap_purge_path', snap.snap_purge_path);

    if (clearError) {
      console.error('[purge-media] could not clear snap pointer', snap.id, clearError.message);
      continue;
    }
    snapsDeleted += 1;
  }

  /*
   * Stories, which had no collector at all.
   *
   * `20260725210000` gave stories an `expires_at` and nothing to act on it, so
   * they left the feed on time and their bytes stayed for ever - the oldest in
   * production was three weeks past its deadline.
   *
   * Unlike a message, an archived-out story has nothing left worth keeping:
   * the row exists only to point at the media, and `story_views`,
   * `story_likes` and `story_audience` all cascade. So the row goes too, and in
   * that order - bytes first, then the row that names them, for the reason set
   * out above.
   */
  const storyCutoff = new Date(Date.now() - STORY_ARCHIVE_MS).toISOString();
  const { data: storyRows, error: storyError } = await admin
    .from('stories')
    .select('id, media_path, audio')
    .lt('expires_at', storyCutoff)
    .limit(BATCH);

  if (storyError) console.error('[purge-media] could not read expired stories', storyError.message);

  let storiesDeleted = 0;

  for (const story of storyRows ?? []) {
    /*
     * A story's sound lives in the same private bucket as its picture and is
     * just as orphaned once the row is gone. `audio` is `[{path, at, ...}]`.
     */
    const audio = Array.isArray(story.audio) ? story.audio : [];
    const paths = [
      story.media_path,
      ...audio.map((clip: { path?: string }) => clip?.path),
    ].filter((path): path is string => typeof path === 'string' && path.length > 0);

    if (paths.length > 0) {
      const { error: removeError } = await admin.storage.from('stories').remove(paths);
      // Already gone is a success, exactly as above.
      if (removeError && !/not\s*found/i.test(removeError.message)) {
        console.error('[purge-media] story delete failed', story.id, removeError.message);
        continue;
      }
    }

    const { error: rowError } = await admin.from('stories').delete().eq('id', story.id);
    if (rowError) {
      console.error('[purge-media] could not delete story row', story.id, rowError.message);
      continue;
    }
    storiesDeleted += 1;
  }

  return Response.json({
    considered: rows.length,
    deleted,
    alreadyGone: missing,
    snapsConsidered: snapRows?.length ?? 0,
    snapsDeleted,
    storiesConsidered: storyRows?.length ?? 0,
    storiesDeleted,
  });
});
