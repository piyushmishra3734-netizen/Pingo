-- Tell the sender when their Ping is opened, and when it is opened again.
--
-- ## Why these two and nothing more
--
-- "Aman sent you a Ping" already existed. "Rahul opened your Ping" and "Riya
-- replayed your Ping" did not, and they are the two moments that belong to the
-- *sender* — the whole reason to send one is to know it landed and was looked
-- at. Anything beyond that (when, for how long, how many times over a week)
-- would be surveillance of the person who opened it, which is not what the
-- exchange is for.
--
-- ## Why the receiver is never told anything
--
-- The bubble says "Ping opened" on the receiver's side because it is describing
-- their own action. The sender gets a notification because it is news to them.
-- Neither is told anything about the other's timing, and the thread deliberately
-- folds exhausted, saved and expired into one state so nobody can infer which.
--
-- ## Why this fires from `open_snap` rather than a trigger
--
-- A trigger on `snap_views` would fire on the row's insert *and* its update,
-- which is exactly the first-view / replay distinction — but it would also fire
-- for the sender re-reading their own Ping, which `open_snap` returns early for
-- before touching the table. Putting it in the function keeps the two rules in
-- one place, where the difference between them is visible.

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications
  add constraint notifications_kind_check
  check (
    kind in (
      'follow_request',
      'follow_accepted',
      'message',
      'snap',
      'story',
      -- The sender's two: first look, and any look after it.
      'ping_opened',
      'ping_replayed'
    )
  );

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
  -- does not consume it, and is not news to anybody.
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

  -- First look, or a replay. The sender is told which.
  perform public.notify_user(
    msg.sender_id,
    auth.uid(),
    case when used = 1 then 'ping_opened' else 'ping_replayed' end,
    msg.conversation_id
  );

  -- The last allowed view in a direct chat means nobody is left to watch it.
  if used >= allowed and public.snap_recipients(msg.conversation_id) <= 1 then
    perform public.destroy_snap(snap_id);
  end if;

  return query select msg.snap_path, greatest(allowed - used, 0);
end;
$$;
