-- Snap lifecycle: two views, manual download, automatic cleanup.
--
-- Version 1 deliberately has no encryption and no screenshot detection. What it
-- does have is a server that forgets: a snap exists only until it has been
-- watched twice, downloaded, or expired -- whichever comes first.
--
-- ## Why the rules live in the database
--
-- Every one of them could be enforced in the client, and every one of them
-- would then be a suggestion. A view counter in JavaScript is a number the
-- viewer controls. These are `security definer` functions instead, so the only
-- way to obtain a snap's bytes is to call `open_snap`, and calling it is what
-- spends the view. There is no path that reads without counting.
--
-- ## Why the storage path, not a URL, is stored on the message
--
-- `media_url` used to hold a signed URL. A URL that is already minted is a URL
-- the client can keep and re-open forever, which makes the view limit
-- decorative. Now the row holds the object's path and a signed URL is issued
-- per view, short-lived, at the moment the view is spent.
--
-- ## One object per conversation, on purpose
--
-- Sending to three friends uploads three copies. That is more bytes than a
-- shared object, and it is what makes "delete the server copy when the receiver
-- downloads it" correct rather than destructive -- one recipient's download
-- cannot take the snap away from the other two.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

alter table public.messages
  add column if not exists snap_path text,
  add column if not exists snap_expires_at timestamptz,
  -- Set when the last recipient's copy is gone. The row survives so the thread
  -- still shows "Snap" in order; only the media is unrecoverable.
  add column if not exists snap_consumed_at timestamptz;

-- ---------------------------------------------------------------------------
-- Per-viewer state
-- ---------------------------------------------------------------------------

-- Views are counted per viewer, not per snap. In a group each person gets their
-- own two -- one member opening it twice must not blind everyone else.
create table if not exists public.snap_views (
  message_id uuid not null references public.messages(id) on delete cascade,
  viewer_id uuid not null references auth.users(id) on delete cascade,
  views integer not null default 0,
  downloaded_at timestamptz,
  primary key (message_id, viewer_id)
);

alter table public.snap_views enable row level security;

create policy "see own snap views"
  on public.snap_views for select to authenticated
  using (viewer_id = auth.uid());

-- No insert/update policy: rows are written only by the security-definer
-- functions below. A viewer who could write here could reset their own counter.

-- ---------------------------------------------------------------------------
-- Opening a snap
-- ---------------------------------------------------------------------------

/*
 * Spends one view and returns the path, or null when there is nothing left.
 *
 * The count is incremented *before* the caller receives anything, so a client
 * that crashes mid-render has still spent the view. The alternative -- trust
 * the client to confirm -- is the same as not counting.
 */
create or replace function public.open_snap(snap_id uuid)
returns table (path text, views_left integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  max_views constant integer := 2;
  msg record;
  used integer;
begin
  select m.id, m.snap_path, m.snap_expires_at, m.snap_consumed_at, m.sender_id, m.conversation_id
    into msg
  from public.messages m
  where m.id = snap_id and m.kind = 'snap';

  if not found then
    return;
  end if;

  -- Membership is the access check; RLS on `messages` cannot help us here
  -- because this function runs as the definer.
  if not public.is_conversation_member(msg.conversation_id) then
    return;
  end if;

  if msg.snap_path is null
     or msg.snap_consumed_at is not null
     or msg.snap_expires_at < now() then
    return;
  end if;

  -- The sender re-reading their own snap does not spend a recipient's views,
  -- and does not consume it. They already have the picture.
  if msg.sender_id = auth.uid() then
    return query select msg.snap_path, max_views;
  end if;

  insert into public.snap_views (message_id, viewer_id, views)
  values (snap_id, auth.uid(), 1)
  on conflict (message_id, viewer_id)
    do update set views = public.snap_views.views + 1
  returning views into used;

  if used > max_views then
    return;
  end if;

  -- Second view in a direct chat means nobody is left to watch it.
  if used >= max_views and public.snap_recipients(msg.conversation_id) <= 1 then
    perform public.destroy_snap(snap_id);
  end if;

  return query select msg.snap_path, greatest(max_views - used, 0);
end;
$$;

/** How many people other than the sender are in a conversation. */
create or replace function public.snap_recipients(conv uuid)
returns integer
language sql
security definer
set search_path = public
as $$
  select greatest(count(*) - 1, 0)::integer
  from public.conversation_members
  where conversation_id = conv;
$$;

-- ---------------------------------------------------------------------------
-- Destroying a snap
-- ---------------------------------------------------------------------------

/*
 * Removes the bytes and marks the row consumed.
 *
 * Storage objects are deleted here rather than from the client because the
 * storage policy only lets the *sender* delete their own folder -- and the
 * person whose download should destroy the copy is the receiver. Doing it in a
 * definer function keeps that policy tight instead of widening it to anyone in
 * the conversation.
 */
create or replace function public.destroy_snap(snap_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target text;
begin
  select snap_path into target from public.messages where id = snap_id;
  if target is null then
    return;
  end if;

  delete from storage.objects where bucket_id = 'snaps' and name = target;

  update public.messages
     set snap_path = null,
         media_url = null,
         snap_consumed_at = now()
   where id = snap_id;
end;
$$;

/*
 * Records a download and destroys the server copy.
 *
 * Separate from `open_snap` because downloading is a decision, not a side
 * effect of looking. The bytes reach the device first -- the client calls this
 * only after the file has been written -- so a failed download does not lose
 * the snap.
 */
create or replace function public.download_snap(snap_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  conv uuid;
begin
  select conversation_id into conv from public.messages where id = snap_id and kind = 'snap';
  if conv is null or not public.is_conversation_member(conv) then
    return;
  end if;

  insert into public.snap_views (message_id, viewer_id, views, downloaded_at)
  values (snap_id, auth.uid(), 0, now())
  on conflict (message_id, viewer_id)
    do update set downloaded_at = now();

  -- In a group the others have not had their turn yet, so only a one-to-one
  -- download destroys the copy immediately. The rest expire.
  if public.snap_recipients(conv) <= 1 then
    perform public.destroy_snap(snap_id);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Expiry
-- ---------------------------------------------------------------------------

/*
 * Deletes every snap past its expiry.
 *
 * Safe to run repeatedly and safe to run often. Schedule it with pg_cron if the
 * extension is available:
 *
 *   select cron.schedule('purge-snaps', '*""/15 * * * *', 'select public.purge_expired_snaps()');
 *
 * Without a scheduler this still runs -- the client calls it opportunistically
 * on sign-in -- which is slower to reclaim storage but never leaves a snap
 * readable past its expiry, because `open_snap` checks the timestamp itself.
 */
create or replace function public.purge_expired_snaps()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  purged integer := 0;
  row record;
begin
  for row in
    select id from public.messages
    where kind = 'snap' and snap_path is not null and snap_expires_at < now()
  loop
    perform public.destroy_snap(row.id);
    purged := purged + 1;
  end loop;

  return purged;
end;
$$;

revoke all on function public.open_snap(uuid) from public;
revoke all on function public.download_snap(uuid) from public;
revoke all on function public.destroy_snap(uuid) from public;
revoke all on function public.purge_expired_snaps() from public;

grant execute on function public.open_snap(uuid) to authenticated;
grant execute on function public.download_snap(uuid) to authenticated;
grant execute on function public.purge_expired_snaps() to authenticated;
-- `destroy_snap` is deliberately not granted: it is only ever reached through
-- the functions above, which check membership first.
