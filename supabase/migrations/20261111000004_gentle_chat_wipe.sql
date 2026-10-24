-- Wiping a deleted chat must not slow the app down while it runs.
--
-- 20261111000002/3 made "delete for everyone" hide the chat at once and wipe the
-- rows afterwards. The wipe was too eager: the request itself deleted 1,500
-- messages (5 seconds on the live database) and the job took five thousand rows
-- a go, four times a minute - 25, 10 and 7 seconds per run, one of 41. Every row
-- delete also checks twelve tables that point at messages, and meanwhile opening
-- a chat took half a minute.
--
-- Nothing about the wipe is urgent: the history is already hidden from both
-- people by `cleared_at`, so the rows are only waiting to be removed from the
-- disk. So now the request only does what has to be true at once - the chat
-- leaves both lists and every file is parked for collection - and the job takes
-- the rest a few hundred rows at a time, a few seconds a minute at most.

create or replace function public.delete_chat_for_everyone(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  kind text;
  asked_at timestamptz := now();
begin
  if not public.is_conversation_member(p_conversation_id) then
    raise exception 'You are not in this chat.';
  end if;

  select c.kind into kind from public.conversations c where c.id = p_conversation_id;
  if kind is distinct from 'direct' then
    raise exception 'Only a one to one chat can be deleted for everyone.';
  end if;

  -- Out of both people's lists, with nothing of the old history left to show.
  update public.conversation_members
     set cleared_at = asked_at,
         deleted_at = asked_at,
         pinned = false,
         marked_unread = false
   where conversation_id = p_conversation_id;

  -- Everything else, including the files, is the job's: see run_chat_wipes.
  insert into public.chat_wipes (conversation_id, requested_by, requested_at)
  values (p_conversation_id, auth.uid(), asked_at)
  on conflict (conversation_id) do update
    set requested_at = greatest(chat_wipes.requested_at, excluded.requested_at);
end;
$$;

/*
 * The minute job. Files first (their pointers have to be parked), then text, in
 * small batches; a chat that still has rows is looked at again next minute.
 */
create or replace function public.run_chat_wipes()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  w record;
  n integer;
  total integer := 0;
  budget integer;
begin
  for w in select conversation_id, requested_at from public.chat_wipes order by requested_at limit 3 loop
    budget := 3;
    -- Files and Pings.
    loop
      n := public.wipe_chat_messages(w.conversation_id, w.requested_at, 200, true);
      total := total + n;
      budget := budget - 1;
      exit when n < 200 or budget <= 0;
    end loop;
    -- Text.
    while budget > 0 loop
      n := public.wipe_chat_messages(w.conversation_id, w.requested_at, 400, false);
      total := total + n;
      budget := budget - 1;
      exit when n < 400;
    end loop;

    if not exists (
      select 1 from public.messages
      where conversation_id = w.conversation_id and created_at <= w.requested_at
        and (
          (deleted_at is null)
          or (photo_path is null and file_path is null and voice_path is null and snap_path is null
              and media_purge_path is null and snap_purge_path is null)
        )
    ) then
      delete from public.chat_wipes where conversation_id = w.conversation_id;
    end if;
  end loop;
  return total;
end;
$$;

revoke all on function public.run_chat_wipes() from public, anon, authenticated;
