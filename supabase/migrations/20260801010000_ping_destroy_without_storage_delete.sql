-- Stop `destroy_snap` throwing, and unbreak the last view of every Ping.
--
-- ## The bug
--
-- `destroy_snap` ended with `delete from storage.objects ...`. Supabase now
-- guards that table with `storage.protect_delete()`, which raises:
--
--   Direct deletion from storage tables is not allowed. Use the Storage API.
--
-- Everything that called it therefore threw, and it was called from the three
-- places that matter:
--
--   * `open_snap`, when the last allowed view is spent in a direct chat. The
--     viewer's counter had already been incremented, so they lost the view
--     *and* got an error instead of the picture. The final look at any Ping —
--     the second of two, or the only one of one — failed.
--   * `download_snap`, so saving a Ping in a one-to-one chat failed.
--   * `purge_expired_snaps`, so nothing was ever reclaimed.
--
-- Found by asserting the view limit against the live database rather than by
-- reading the function.
--
-- ## The fix separates two things that were tangled
--
-- **Making the media unreachable** is a row update: clear `snap_path`, set
-- `snap_consumed_at`. `open_snap` already refuses on both, the bucket is
-- private, and the only URLs ever minted are short-lived and issued by
-- `open_snap` itself. That is the property the product promises, and SQL can
-- still deliver all of it.
--
-- **Reclaiming the bytes** now has to go through the Storage API, which SQL
-- cannot call. So the path is parked in `snap_purge_path` and a client sweeps
-- it up. That is a delay in freeing storage, not a window in which anybody can
-- read the Ping.
--
-- ## Why the sender's client does the sweeping
--
-- The storage policy lets only the uploader delete their own folder, and that
-- is worth keeping tight. The sender is the uploader, so `pending_snap_purges`
-- returns a caller only their own orphans — which is also why it cannot be used
-- to enumerate anybody else's.

alter table public.messages
  add column if not exists snap_purge_path text;

create index if not exists messages_snap_purge_idx
  on public.messages (sender_id)
  where snap_purge_path is not null;

/*
 * Makes a Ping unreachable, and parks its object for collection.
 *
 * No longer touches `storage.objects`. See the note above: unreachable is a row
 * update, and the bytes are somebody else's job now.
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

  update public.messages
     set snap_path = null,
         media_url = null,
         snap_consumed_at = now(),
         -- Kept so the object can still be found and removed. Nothing reads
         -- this to serve media — `open_snap` looks at `snap_path`, which is now
         -- null, so the Ping is already gone as far as any reader is concerned.
         snap_purge_path = target
   where id = snap_id;
end;
$$;

/**
 * Objects the caller uploaded that are finished with and can be deleted.
 *
 * Only ever the caller's own: the storage policy lets nobody else delete them,
 * so returning anybody else's would be a list of paths the reader cannot act on
 * and has no business seeing.
 */
create or replace function public.pending_snap_purges()
returns table (message_id uuid, path text)
language sql
security definer
set search_path = public
stable
as $$
  select id, snap_purge_path
  from public.messages
  where sender_id = auth.uid()
    and snap_purge_path is not null
  limit 200;
$$;

revoke all on function public.pending_snap_purges() from public;
grant execute on function public.pending_snap_purges() to authenticated;

/**
 * Clears the marker once the client has actually removed the object.
 *
 * Called after the Storage API call succeeds, never before — a marker cleared
 * on an object that is still there is an orphan nobody will ever look for
 * again.
 */
create or replace function public.snap_purged(ids uuid[])
returns void
language sql
security definer
set search_path = public
as $$
  update public.messages
     set snap_purge_path = null
   where id = any(ids) and sender_id = auth.uid();
$$;

revoke all on function public.snap_purged(uuid[]) from public;
grant execute on function public.snap_purged(uuid[]) to authenticated;
