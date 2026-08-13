-- Storage becomes a delivery buffer for *all* chat media, not only video.
--
-- `20260911000000_media_receipts` established the contract - a receipt means
-- "the whole file is on my device", written only after the local put resolves -
-- and applied it to video alone, with a view and no collector. Everything else
-- a person sends stayed on the server for ever, so the bill grew with the
-- history rather than with the traffic.
--
-- This extends the same contract to photos, documents and voice notes, gives
-- every new object a hard expiry, and adds the collector.
--
-- ## Why Postgres does not delete the bytes
--
-- Deleting a `storage.objects` row hides a file from the API and leaves the
-- bytes in the bucket, which converts a storage bill into an invisible one -
-- and the storage policies deliberately let nobody but the uploader remove
-- their own objects. So the database's job here is to decide *what* may go and
-- park it; the removal is done by the uploader's own client through the Storage
-- API, exactly as `20260801010000_ping_destroy_without_storage_delete` set up
-- for Pings.
--
-- ## The pointer outlives the object, never the other way round
--
-- That migration also recorded the bug this one must not repeat: nulling the
-- path before the object is gone loses the only reference to it. So a parked
-- object keeps its live pointer until the client confirms the delete, and only
-- then is the pointer cleared. A reader that meets a signed URL for bytes that
-- have already gone falls back to its local copy, which is the point of the
-- whole design.
--
-- ## Nothing old is touched
--
-- Expiry is stamped by a trigger on insert, so every message written before
-- this migration has `media_expires_at` null and is never collected. Legacy
-- media keeps working exactly as it does today; only new media is temporary.

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------

alter table public.messages
  -- The hard ceiling. Set on insert for new media only; null means legacy.
  add column if not exists media_expires_at timestamptz,
  -- Parked for the uploader's client to delete, with the bucket it lives in.
  add column if not exists media_purge_path text,
  add column if not exists media_purge_bucket text,
  -- When the object was actually removed. Reader-facing paths stay usable
  -- until then; after it, clients fall back to their local copy.
  add column if not exists media_purged_at timestamptz;

comment on column public.messages.media_expires_at is
  'Hard maximum lifetime of the server copy. Null on messages written before the local-first lifecycle, which are never collected.';
comment on column public.messages.media_purge_path is
  'Object parked for deletion by the uploader''s client. The live path column is kept until the delete is confirmed, so the object can never be orphaned.';

create index if not exists messages_media_purge_idx
  on public.messages (sender_id)
  where media_purge_path is not null;

create index if not exists messages_media_expiry_idx
  on public.messages (media_expires_at)
  where media_expires_at is not null and media_purge_path is null;

-- ---------------------------------------------------------------------------
-- 2. Retention policy, in one place
-- ---------------------------------------------------------------------------

/*
 * Two numbers, named rather than repeated.
 *
 * The minimum is what protects a recipient whose local copy did not survive -
 * a reinstall the same afternoon, a quota eviction, a device restored from a
 * backup taken before the message. The maximum is what stops one person who
 * never comes back from keeping everybody's media for ever.
 */
create or replace function public.media_min_retention()
returns interval language sql immutable as $$ select interval '7 days' $$;

create or replace function public.media_max_retention()
returns interval language sql immutable as $$ select interval '30 days' $$;

/*
 * How long an upload may sit without a message before it is assumed abandoned.
 *
 * Long enough that a slow phone finishing a large upload and then inserting the
 * row is never caught; short enough that a failed insert does not leave bytes
 * around for a week.
 */
create or replace function public.media_upload_grace()
returns interval language sql immutable as $$ select interval '2 hours' $$;

-- ---------------------------------------------------------------------------
-- 3. Every new media message gets an expiry
-- ---------------------------------------------------------------------------

create or replace function public.messages_stamp_media_expiry()
returns trigger
language plpgsql
as $$
begin
  if new.media_expires_at is null
     and (new.photo_path is not null
          or new.file_path is not null
          or new.voice_path is not null) then
    new.media_expires_at := now() + public.media_max_retention();
  end if;
  return new;
end;
$$;

drop trigger if exists messages_stamp_media_expiry on public.messages;
create trigger messages_stamp_media_expiry
  before insert on public.messages
  for each row
  execute function public.messages_stamp_media_expiry();

-- ---------------------------------------------------------------------------
-- 4. What "delivered" means, for every kind of media
-- ---------------------------------------------------------------------------

/*
 * One row per message whose media every other member holds a copy of.
 *
 * The sender is excluded - they have the original, and waiting for a receipt
 * from them would mean waiting for ever. `delivered_at` is the last receipt,
 * which is what the minimum retention is measured from: the clock starts when
 * the file was *fully* delivered, not when it was sent.
 *
 * Replaces the video-only view of 20260911000000. The name is kept because it
 * is the name the contract was written under.
 */
drop view if exists public.media_fully_delivered;
create view public.media_fully_delivered as
  select
    m.id as message_id,
    m.sender_id,
    m.conversation_id,
    coalesce(m.photo_path, m.file_path, m.voice_path) as path,
    case
      when m.photo_path is not null then 'photos'
      when m.file_path is not null then 'documents'
      when m.voice_path is not null then 'voice'
    end as bucket,
    m.created_at,
    m.media_expires_at,
    (
      select max(r.received_at)
      from public.media_receipts r
      where r.message_id = m.id
    ) as delivered_at
  from public.messages m
  where coalesce(m.photo_path, m.file_path, m.voice_path) is not null
    and m.media_purge_path is null
    -- Only media written under this lifecycle. Legacy rows have no expiry and
    -- are deliberately out of reach of the collector.
    and m.media_expires_at is not null
    and not exists (
      select 1
      from public.conversation_members cm
      where cm.conversation_id = m.conversation_id
        and cm.user_id <> m.sender_id
        and not exists (
          select 1
          from public.media_receipts r
          where r.message_id = m.id
            and r.user_id = cm.user_id
        )
    );

-- ---------------------------------------------------------------------------
-- 5. The collector
-- ---------------------------------------------------------------------------

/*
 * Parks every object that has earned deletion. Returns how many.
 *
 * Two ways in, and only two:
 *
 *   · everyone has confirmed a local copy, and the minimum retention has
 *     passed since the last of them did
 *   · the object has reached its maximum lifetime, whoever is still missing
 *
 * Idempotent by construction: a parked row has `media_purge_path` set and is
 * excluded from both queries, so running this twice parks nothing twice. It
 * touches no storage - see the note at the top - and it never clears the live
 * pointer, which is `confirm_media_purged`'s job once the bytes are actually
 * gone.
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

  -- The ceiling. Nothing about receipts here on purpose: this is the case
  -- where the receipts are never coming.
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

  return parked + expired_count;
end;
$$;

comment on function public.purge_delivered_media is
  'Parks server copies that have been fully delivered (plus the minimum retention) or have reached their maximum lifetime. Deletes nothing itself: the uploader''s client removes the object and calls confirm_media_purged.';

-- ---------------------------------------------------------------------------
-- 6. The uploader's side of the collection
-- ---------------------------------------------------------------------------

/*
 * Objects the caller uploaded that are ready to be deleted.
 *
 * Only ever the caller's own, for the same reason `pending_snap_purges` is:
 * the storage policy lets nobody else remove them, so anybody else's paths
 * would be a list the reader cannot act on and has no business seeing.
 */
create or replace function public.pending_media_purges()
returns table (message_id uuid, path text, bucket text)
language sql
security definer
set search_path = public
stable
as $$
  select id, media_purge_path, media_purge_bucket
  from public.messages
  where sender_id = auth.uid()
    and media_purge_path is not null
    and media_purged_at is null
  limit 200;
$$;

/*
 * The bytes are gone; now the pointer may go.
 *
 * This order is the whole lesson of the Ping bug: a pointer cleared first
 * leaves an object nobody can name. Readers that still had the old URL fall
 * back to their local copy, which by this point every recipient has.
 */
create or replace function public.confirm_media_purged(target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.messages
     set media_purged_at = now(),
         media_purge_path = null,
         photo_path = case when photo_path = media_purge_path then null else photo_path end,
         file_path = case when file_path = media_purge_path then null else file_path end,
         voice_path = case when voice_path = media_purge_path then null else voice_path end,
         media_url = null
   where id = target
     and sender_id = auth.uid()
     and media_purge_path is not null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Abandoned uploads
-- ---------------------------------------------------------------------------

/*
 * An upload announces itself before it happens, and is forgotten when the
 * message that owns it exists.
 *
 * The gap between "object uploaded" and "row inserted" is where orphans come
 * from: an insert that fails leaves bytes nothing points at, and nothing can
 * find them again because the only reference was in the failed statement. A
 * claim written first turns that into a list.
 */
create table if not exists public.media_uploads (
  path text primary key,
  bucket text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.media_uploads enable row level security;

drop policy if exists "own uploads insert" on public.media_uploads;
create policy "own uploads insert" on public.media_uploads
  for insert with check (user_id = auth.uid());

drop policy if exists "own uploads read" on public.media_uploads;
create policy "own uploads read" on public.media_uploads
  for select using (user_id = auth.uid());

drop policy if exists "own uploads delete" on public.media_uploads;
create policy "own uploads delete" on public.media_uploads
  for delete using (user_id = auth.uid());

create index if not exists media_uploads_user_age_idx
  on public.media_uploads (user_id, created_at);

/*
 * The caller's uploads that never became a message and are past the grace
 * period. In-flight uploads are protected by that period, not by a guess.
 */
create or replace function public.abandoned_uploads()
returns table (path text, bucket text)
language sql
security definer
set search_path = public
stable
as $$
  select u.path, u.bucket
  from public.media_uploads u
  where u.user_id = auth.uid()
    and u.created_at < now() - public.media_upload_grace()
    and not exists (
      select 1 from public.messages m
      where m.photo_path = u.path
         or m.file_path = u.path
         or m.voice_path = u.path
         or m.snap_path = u.path
    )
  limit 200;
$$;

-- ---------------------------------------------------------------------------
-- 8. Deleting a message must not leave bytes behind
-- ---------------------------------------------------------------------------

/*
 * Delete for everyone, without the leak.
 *
 * The previous version cleared `media_url` and `snap_path` and left the object
 * where it was - permanently, since the row that named it had just been
 * emptied. Now the path is parked first and the live pointers are cleared by
 * the same rule as everywhere else: only once the uploader's client has removed
 * the object and said so.
 *
 * `snap_purge_path` is reused for Pings so the existing Ping collector keeps
 * working unchanged.
 */
create or replace function public.delete_message(target uuid, for_everyone boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
begin
  select * into m from public.messages where id = target;
  if m is null or not public.is_conversation_member(m.conversation_id) then
    return;
  end if;

  if for_everyone then
    if m.sender_id <> auth.uid() then
      return;
    end if;

    update public.messages
       set deleted_at = now(),
           body = '',
           -- Parked, not dropped. The pointer stays until the bytes are gone.
           media_purge_path = coalesce(
             media_purge_path,
             m.photo_path, m.file_path, m.voice_path
           ),
           media_purge_bucket = coalesce(
             media_purge_bucket,
             case
               when m.photo_path is not null then 'photos'
               when m.file_path is not null then 'documents'
               when m.voice_path is not null then 'voice'
             end
           ),
           -- A Ping goes through the collector that already exists for Pings.
           snap_purge_path = coalesce(snap_purge_path, m.snap_path)
     where id = target;
  else
    insert into public.hidden_messages (message_id, user_id)
    values (target, auth.uid())
    on conflict do nothing;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Schedules
-- ---------------------------------------------------------------------------

/*
 * The collector, and the snap purge that was only ever a comment.
 *
 * `20260726180000_snap_lifecycle` wrote its `cron.schedule` inside a note, so
 * nothing has been reclaiming unopened Pings since. Both are scheduled here,
 * guarded so re-running this migration does not double-schedule.
 */
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('pingo-media-purge')
      where exists (select 1 from cron.job where jobname = 'pingo-media-purge');
    perform cron.schedule('pingo-media-purge', '23 * * * *',
      $job$select public.purge_delivered_media();$job$);

    perform cron.unschedule('pingo-snap-purge')
      where exists (select 1 from cron.job where jobname = 'pingo-snap-purge');
    perform cron.schedule('pingo-snap-purge', '*/15 * * * *',
      $job$select public.purge_expired_snaps();$job$);
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 10. Size ceilings at the bucket
-- ---------------------------------------------------------------------------

/*
 * The last line of defence, not the first.
 *
 * The client refuses an oversized file with a sentence somebody can act on;
 * this is what stops a modified client from uploading a gigabyte anyway. The
 * numbers match `packages/core/src/media-limits.ts`.
 */
update storage.buckets set file_size_limit = 104857600 where id = 'documents'; -- 100 MB
update storage.buckets set file_size_limit =  26214400 where id = 'photos';    --  25 MB
update storage.buckets set file_size_limit =  26214400 where id = 'voice';     --  25 MB
update storage.buckets set file_size_limit =  26214400 where id = 'snaps';     --  25 MB
