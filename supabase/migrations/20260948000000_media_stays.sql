/*
 * Chat media stays. Stories are the thing with a clock on them.
 *
 * ## What was happening
 *
 * Two rules deleted every photo, voice note and document people sent each
 * other: a ceiling at `created_at + 24 hours`, and a delivery rule that parked
 * media an hour after the last recipient confirmed a local copy. Between them,
 * 930 of the 947 media messages this account has ever held are already gone.
 *
 * They were written to keep the server small. Measured, they were not doing
 * that: chat media in Storage is 5% of the free bucket, while the database sits
 * at 43% of its cap - and none of that 43% is media. The rule cost real
 * photographs to protect a resource that was never under pressure.
 *
 * ## What holds a clock now
 *
 * - Stories: `stories.expires_at`, 24 hours, unchanged. This is the one the
 *   product actually promises.
 * - Pings: `purge_expired_snaps` and the view limit, unchanged.
 * - Disappearing messages: `messages.expires_at` and `expire_messages()`,
 *   unchanged - they park their own media when they sweep.
 *
 * Anything else somebody sent, they keep.
 */

/*
 * Rewritten before the retention functions it calls are dropped.
 *
 * Only the explicit branch survives, and only for a stamp somebody set on
 * purpose. Nothing writes `media_expires_at` any more (the trigger below is
 * gone), so in practice this now sweeps nothing - it is kept rather than
 * dropped because `media_sweeper_tick` calls it every ten minutes and because
 * it is where a future timed-media feature belongs.
 */
create or replace function public.purge_delivered_media()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare
  expired_count integer := 0;
begin
  with expired as (
    select id,
           coalesce(photo_path, file_path, voice_path) as path,
           case
             when photo_path is not null then 'photos'
             when file_path is not null then 'documents'
             when voice_path is not null then 'voice'
           end as bucket
    from public.messages
    where media_expires_at is not null
      and media_expires_at < now()
      and media_purge_path is null
      and coalesce(photo_path, file_path, voice_path) is not null
  )
  update public.messages m
     set media_purge_path = x.path,
         media_purge_bucket = x.bucket
    from expired x
   where m.id = x.id
     and m.media_purge_path is null;

  get diagnostics expired_count = row_count;
  return expired_count;
end;
$$;

comment on function public.purge_delivered_media() is
  'Parks media whose media_expires_at was set deliberately. Nothing stamps that column any more: ordinary chat media is kept.';

-- Nothing stamps an expiry on ordinary media any more.
drop trigger if exists messages_stamp_media_expiry on public.messages;
drop function if exists public.messages_stamp_media_expiry();

-- No longer referenced by anything, in the database or the app.
drop function if exists public.media_min_retention();
drop function if exists public.media_max_retention();

/*
 * Stamps already written by the trigger are deadlines nobody chose. Cleared for
 * every row that still has its file; rows already swept keep their history.
 */
update public.messages
   set media_expires_at = null
 where media_expires_at is not null
   and coalesce(photo_path, file_path, voice_path) is not null;
