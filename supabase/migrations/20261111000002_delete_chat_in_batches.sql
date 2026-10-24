-- "Delete chat for everyone" on a long chat: do it in batches, not in one statement.
--
-- ## What was wrong
--
-- `delete_chat_for_everyone` (20261104000000) rewrote every message of the chat in
-- one UPDATE. Measured on the largest direct chat here: 5,000 rows take 1.6
-- seconds, and that chat has 42,000. The `authenticated` role stops a statement
-- after 8 seconds, so on a long chat the whole thing was cancelled and the app
-- said "Deleting didn't work. Try again." - every time, because the chat only
-- gets longer.
--
-- ## What this does
--
-- The request does what has to be true at once, and queues the rest:
--
--   1. the chat leaves the deleter's list immediately (as before);
--   2. every message that carries media is wiped and its file parked for
--      collection now, because that is the part that must not wait;
--   3. the first fifteen hundred text messages are wiped now;
--   4. anything left is queued in `chat_wipes`, and a job every minute wipes it
--      five thousand rows at a time until none is left.
--
-- The other person sees the messages turn into "This message was deleted"
-- progressively instead of all at once; the end state is the same as before.
-- Only messages that existed when the request was made are wiped, so something
-- sent afterwards in the same chat is never swept up with it.

create table if not exists public.chat_wipes (
  conversation_id uuid primary key references public.conversations (id) on delete cascade,
  requested_by uuid not null references auth.users (id) on delete cascade,
  requested_at timestamptz not null default now()
);

alter table public.chat_wipes enable row level security;
-- No policies: only the functions below touch it.

/*
 * Wipes up to `p_limit` of a chat's messages that existed at `p_before`, the way
 * `delete_chat_for_everyone` always has: tombstoned, body gone, the file parked
 * (never dropped: the pointer stays until the bytes are) and a Ping handed to
 * the Ping collector. Returns how many it did. `p_media_only` is the pass that
 * must not wait. Internal: nobody can call it.
 */
create or replace function public.wipe_chat_messages(
  p_conversation_id uuid,
  p_before timestamptz,
  p_limit integer,
  p_media_only boolean
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  with pick as (
    select id
    from public.messages
    where conversation_id = p_conversation_id
      and deleted_at is null
      and created_at <= p_before
      and (
        not p_media_only
        or photo_path is not null or file_path is not null
        or voice_path is not null or snap_path is not null
      )
    -- A long statement on a hot row must not hold up somebody sending a message.
    for update skip locked
    limit p_limit
  )
  update public.messages m
     set deleted_at = now(),
         body = '',
         media_purge_path = coalesce(m.media_purge_path, m.photo_path, m.file_path, m.voice_path),
         media_purge_bucket = coalesce(
           m.media_purge_bucket,
           case
             when m.photo_path is not null then 'photos'
             when m.file_path is not null then 'documents'
             when m.voice_path is not null then 'voice'
           end
         ),
         snap_purge_path = coalesce(m.snap_purge_path, m.snap_path)
    from pick
   where m.id = pick.id;

  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.wipe_chat_messages(uuid, timestamptz, integer, boolean) from public, anon, authenticated;

create or replace function public.delete_chat_for_everyone(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  kind text;
  asked_at timestamptz := now();
  left_over integer;
begin
  if not public.is_conversation_member(p_conversation_id) then
    raise exception 'You are not in this chat.';
  end if;

  select c.kind into kind from public.conversations c where c.id = p_conversation_id;
  if kind is distinct from 'direct' then
    raise exception 'Only a one to one chat can be deleted for everyone.';
  end if;

  -- Out of the deleter's own list first, the way "Delete chat" does it.
  update public.conversation_members
     set cleared_at = now(),
         deleted_at = now(),
         pinned = false,
         marked_unread = false
   where conversation_id = p_conversation_id
     and user_id = auth.uid();

  -- What must not wait: every file, and then a first batch of the rest.
  perform public.wipe_chat_messages(p_conversation_id, asked_at, 1000000, true);
  perform public.wipe_chat_messages(p_conversation_id, asked_at, 1500, false);

  select count(*) into left_over
  from (
    select 1 from public.messages
    where conversation_id = p_conversation_id and deleted_at is null and created_at <= asked_at
    limit 1
  ) s;

  if left_over > 0 then
    insert into public.chat_wipes (conversation_id, requested_by, requested_at)
    values (p_conversation_id, auth.uid(), asked_at)
    on conflict (conversation_id) do update set requested_at = greatest(chat_wipes.requested_at, excluded.requested_at);
  end if;
end;
$$;

revoke execute on function public.delete_chat_for_everyone(uuid) from public, anon;
grant execute on function public.delete_chat_for_everyone(uuid) to authenticated;

/*
 * The minute job: finish what was queued. A few batches per chat per run, so a
 * 40,000 message chat is done in a few minutes and one run is never long.
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
  rounds integer;
  total integer := 0;
begin
  for w in select conversation_id, requested_at from public.chat_wipes order by requested_at limit 20 loop
    rounds := 0;
    loop
      n := public.wipe_chat_messages(w.conversation_id, w.requested_at, 5000, false);
      total := total + n;
      rounds := rounds + 1;
      if n < 5000 then
        -- Fewer than a full batch: either done, or the rest is locked by somebody
        -- right now. Done only if nothing is left to wipe.
        if not exists (
          select 1 from public.messages
          where conversation_id = w.conversation_id and deleted_at is null and created_at <= w.requested_at
        ) then
          delete from public.chat_wipes where conversation_id = w.conversation_id;
        end if;
        exit;
      end if;
      exit when rounds >= 4;
    end loop;
  end loop;
  return total;
end;
$$;

revoke all on function public.run_chat_wipes() from public, anon, authenticated;

select cron.schedule('chat-wipes', '* * * * *', $$select public.run_chat_wipes()$$);

notify pgrst, 'reload schema';
