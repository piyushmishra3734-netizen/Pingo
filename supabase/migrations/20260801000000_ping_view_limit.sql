-- Ping: the sender chooses how many views, instead of everyone getting two.
--
-- ## What changes, and what deliberately does not
--
-- `open_snap` held `max_views constant integer := 2`. That was the whole rule,
-- and it was the same rule for everybody. A Ping now carries its own allowance
-- in `messages.view_limit` — the column the photo messages already use — so one
-- picture can be a single look and the next can be two.
--
-- Nothing else about the lifecycle moves. The count is still incremented before
-- the caller receives anything, the server copy is still destroyed when the last
-- recipient has used their views, and the only way to obtain the bytes is still
-- to call this function. Those are the properties that make the limit real
-- rather than decorative, and they were already right.
--
-- ## Why "Keep in Chat" is not a third value here
--
-- A Ping the sender wants to stay is a photo. The product already has that: a
-- `photo` message with no view limit, which lives in the thread and can be
-- reopened freely. Adding `view_limit = null means unlimited` to *this*
-- function would give the ephemeral path a mode where it never expires and
-- never destroys anything — a snap that is not a snap, sharing code with one
-- that is, and one `if` away from a bug that leaks the wrong media forever.
--
-- So the send flow picks the mechanism: one or two views is this path, keep in
-- chat is the photo path. Two behaviours that already exist, each correct for
-- what it is.
--
-- ## Why the default is still two
--
-- Rows written before this migration have no `view_limit`, and a Ping in flight
-- when it ran must not silently become unopenable or unlimited. `coalesce`
-- gives them exactly what they were sent with.

create or replace function public.open_snap(snap_id uuid)
returns table (path text, views_left integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  allowed integer;
  msg record;
  used integer;
begin
  select m.id, m.snap_path, m.snap_expires_at, m.snap_consumed_at, m.sender_id,
         m.conversation_id, m.view_limit
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

  /*
   * The sender's own choice, or two for anything sent before there was a
   * choice. Clamped to 1–2: the column is shared with photo messages, where a
   * larger number is meaningful, and a Ping that could be opened nine times is
   * not a Ping.
   */
  allowed := least(greatest(coalesce(msg.view_limit, 2), 1), 2);

  -- The sender re-reading their own Ping does not spend a recipient's views,
  -- and does not consume it. They already have the picture.
  if msg.sender_id = auth.uid() then
    return query select msg.snap_path, allowed;
  end if;

  insert into public.snap_views (message_id, viewer_id, views)
  values (snap_id, auth.uid(), 1)
  on conflict (message_id, viewer_id)
    do update set views = public.snap_views.views + 1
  returning views into used;

  if used > allowed then
    return;
  end if;

  -- The last allowed view in a direct chat means nobody is left to watch it.
  if used >= allowed and public.snap_recipients(msg.conversation_id) <= 1 then
    perform public.destroy_snap(snap_id);
  end if;

  return query select msg.snap_path, greatest(allowed - used, 0);
end;
$$;
