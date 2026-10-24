-- A chat that was deleted or cleared stays empty, and "delete for everyone" takes
-- the chat away from both people, the way Telegram does.
--
-- ## What was wrong
--
-- Deleting a chat set `cleared_at` and `deleted_at` on the member, and the chat
-- list honoured them. The thread itself never did: `messages_page` returned the
-- whole conversation. So the moment either person wrote again - or the deleter
-- opened a profile and sent a message - the chat came back with every old
-- message in it. And "delete for everyone" only hid the chat from the deleter,
-- leaving the other person a thread of "This message was deleted".
--
-- ## What this does
--
--   1. `messages_page` returns a member only the messages after *their own*
--      `cleared_at`. Everything that reads a thread through it - every device,
--      every refresh, the delta that follows the sync cursor - agrees.
--   2. `delete_chat_for_everyone` clears and deletes the chat for every member,
--      not just the one who asked. The chat is gone from both lists, and a new
--      message starts it again, empty.
--   3. The wipe removes text messages outright instead of rewriting each into
--      "This message was deleted". Nobody is left to read a tombstone, and a
--      rewrite of 42,000 rows is 42,000 Realtime updates that every open copy of
--      PINGO decrypts, signs and stores one by one: a minute of frozen screen.
--      The app does not listen for deletions, so a delete costs it nothing.
--      Rows that carry a file are still rewritten, because the pointer to the
--      file has to outlive the row until the file is gone.

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
  if p_media_only then
    -- Files and Pings: rewritten, with the file parked for collection.
    with pick as (
      select id
      from public.messages
      where conversation_id = p_conversation_id
        and deleted_at is null
        and created_at <= p_before
        and (photo_path is not null or file_path is not null or voice_path is not null or snap_path is not null)
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
  else
    -- Everything else is text: gone outright. Replies to it lose the link (SET NULL).
    with pick as (
      select id
      from public.messages
      where conversation_id = p_conversation_id
        and created_at <= p_before
        and photo_path is null and file_path is null and voice_path is null and snap_path is null
        and media_purge_path is null and snap_purge_path is null
      for update skip locked
      limit p_limit
    )
    delete from public.messages m using pick where m.id = pick.id;
  end if;

  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.wipe_chat_messages(uuid, timestamptz, integer, boolean) from public, anon, authenticated;

create or replace function public.messages_page(
  conv uuid,
  device uuid,
  page_limit integer default 50,
  before_at timestamptz default null,
  since timestamptz default null,
  ids uuid[] default null
)
returns setof jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  me uuid := auth.uid();
  from_at timestamptz;
begin
  if me is null then
    raise exception 'not signed in';
  end if;

  if not exists (
    select 1 from public.device_keys d where d.device_id = device and d.user_id = me
  ) then
    raise exception 'unknown device';
  end if;

  /*
   * By id, for the conversation list.
   *
   * No `conversation_id` filter - these ids span every conversation the reader
   * is in. RLS decides they may see them; `security invoker` keeps that check.
   * Whatever the reader cleared stays cleared here too.
   */
  if ids is not null then
    return query
      select public.trim_envelope(to_jsonb(m), device)
      from public.messages m
      where m.id = any(ids)
        and not exists (
          select 1
          from public.conversation_members cm
          where cm.conversation_id = m.conversation_id
            and cm.user_id = me
            and cm.cleared_at is not null
            and m.created_at <= cm.cleared_at
        );
    return;
  end if;

  -- Where this reader's history begins: after what they cleared, if they did.
  select cm.cleared_at into from_at
  from public.conversation_members cm
  where cm.conversation_id = conv and cm.user_id = me;

  if since is not null then
    return query
      select public.trim_envelope(to_jsonb(m), device)
      from public.messages m
      where m.conversation_id = conv
        and m.updated_at > since
        and (from_at is null or m.created_at > from_at)
      order by m.updated_at asc
      limit page_limit;
    return;
  end if;

  return query
    select public.trim_envelope(to_jsonb(m), device)
    from public.messages m
    where m.conversation_id = conv
      and (before_at is null or m.created_at < before_at)
      and (from_at is null or m.created_at > from_at)
    order by m.created_at desc
    limit page_limit;
end;
$$;

-- ---------------------------------------------------------------------------

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

  -- Out of both people's lists, with nothing of the old history left to show.
  update public.conversation_members
     set cleared_at = asked_at,
         deleted_at = asked_at,
         pinned = false,
         marked_unread = false
   where conversation_id = p_conversation_id;

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

notify pgrst, 'reload schema';
