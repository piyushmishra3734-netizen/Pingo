-- Chat media leaves the server 24 hours after it was sent. No exceptions, and
-- nothing to keep in sync.
--
-- ## The number is now read at collection time, not written at insert time
--
-- This is the actual fix, and the reason the last two migrations both had to
-- rewrite rows. `messages_stamp_media_expiry` stamps `now() +
-- media_max_retention()` into `media_expires_at` when the row is inserted, and
-- the collector then read that column. So changing the retention changed the
-- deadline for messages nobody had sent yet and left every existing message on
-- the schedule it was born with - twice now, that meant a follow-up UPDATE
-- across the whole table.
--
-- The ceiling is computed from `created_at` instead. Changing
-- `media_max_retention()` from here on takes effect on the next tick, for
-- everything, with no backfill. The stamped column is kept and still honoured
-- as an upper bound, so anything that deliberately sets an *earlier* expiry -
-- disappearing messages - still wins.
--
-- ## What this deletes, and what it does not
--
-- Only what `messages.photo_path`, `file_path` and `voice_path` point at: the
-- photos, GIFs, videos, documents and voice notes people send each other.
--
-- Avatars and posts are in their own buckets, are not reachable from these
-- columns, and are not touched - a profile picture that vanished after a day
-- would not be a profile picture. Pings (`snaps`) and stories keep the
-- lifecycles they already have.
--
-- ## The receipt rule is now unreachable, on purpose
--
-- `media_min_retention` measures 24 hours from the last recipient confirming a
-- complete local copy, which is always after the message was sent - so the
-- ceiling always fires first. It is left in place rather than deleted: it is
-- the safer of the two rules, and it is what comes back if this ceiling is ever
-- raised again.

create or replace function public.media_max_retention()
returns interval language sql immutable as $$ select interval '24 hours' $$;

/*
 * Parks every object that has earned deletion. Returns how many.
 *
 * Unchanged except for the ceiling, which is `least(stamp, created + max)`
 * rather than the stamp alone. `media_expires_at is not null` stays as the
 * "is this row under the lifecycle at all" test; every live media row has been
 * backfilled with one by 20260927000000.
 */
create or replace function public.purge_delivered_media()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  parked integer := 0;
  expired_count integer := 0;
begin
  with eligible as (
    select message_id, path, bucket
    from public.media_fully_delivered
    where delivered_at is not null
      and delivered_at < now() - public.media_min_retention()
  )
  update public.messages m
     set media_purge_path = e.path,
         media_purge_bucket = e.bucket
    from eligible e
   where m.id = e.message_id
     and m.media_purge_path is null;

  get diagnostics parked = row_count;

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
      -- The live ceiling. An earlier stamp still wins, so a disappearing
      -- message set to go sooner is not pushed back out to 24 hours.
      and least(media_expires_at, created_at + public.media_max_retention()) < now()
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

  return parked + expired_count;
end;
$$;

comment on function public.purge_delivered_media is
  'Parks server copies 24 hours after they were sent, or sooner if every recipient confirmed a local copy. The ceiling is read from media_max_retention() at collection time, so changing that function needs no backfill.';

/*
 * Hourly was right for a thirty-day ceiling. With a 24-hour one it means an
 * object can outlive its deadline by most of an hour, which is a long time to
 * be holding bytes somebody was told are gone.
 */
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('pingo-media-sweep')
      where exists (select 1 from cron.job where jobname = 'pingo-media-sweep');

    perform cron.schedule('pingo-media-sweep', '*/10 * * * *',
      $job$select public.media_sweeper_tick();$job$);
  end if;
end
$$;
