-- Delete for everyone, in one to one chats, for anybody in them.
--
-- Telegram's rule, and only for direct chats:
--
--   1. In a direct chat either person can delete any message for both of them,
--      theirs or the other's. The tombstone stays, so the other side always sees
--      that a message was deleted. Nothing disappears silently.
--   2. Either person can delete the whole chat for both of them. Every message
--      in it becomes that same tombstone; the other person keeps the chat in
--      their list, and inside it every message reads as deleted. It leaves the
--      deleter's own list, and a new message brings it back empty.
--
-- Groups, communities and PINGO AI chats are unchanged: there you can still
-- delete only your own messages for everyone.

create or replace function public.delete_message(target uuid, for_everyone boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
  kind text;
begin
  select * into m from public.messages where id = target;
  if m is null or not public.is_conversation_member(m.conversation_id) then
    return;
  end if;

  if for_everyone then
    select c.kind into kind from public.conversations c where c.id = m.conversation_id;

    -- Your own, or anybody's in a one to one chat.
    if m.sender_id <> auth.uid() and kind is distinct from 'direct' then
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

create or replace function public.delete_chat_for_everyone(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  kind text;
begin
  if not public.is_conversation_member(p_conversation_id) then
    raise exception 'You are not in this chat.';
  end if;

  select c.kind into kind from public.conversations c where c.id = p_conversation_id;
  if kind is distinct from 'direct' then
    raise exception 'Only a one to one chat can be deleted for everyone.';
  end if;

  update public.messages
     set deleted_at = now(),
         body = '',
         media_purge_path = coalesce(media_purge_path, photo_path, file_path, voice_path),
         media_purge_bucket = coalesce(
           media_purge_bucket,
           case
             when photo_path is not null then 'photos'
             when file_path is not null then 'documents'
             when voice_path is not null then 'voice'
           end
         ),
         snap_purge_path = coalesce(snap_purge_path, snap_path)
   where conversation_id = p_conversation_id
     and deleted_at is null;

  -- Out of the deleter's own list too, the way "Delete chat" does it.
  update public.conversation_members
     set cleared_at = now(),
         deleted_at = now(),
         pinned = false,
         marked_unread = false
   where conversation_id = p_conversation_id
     and user_id = auth.uid();
end;
$$;

revoke execute on function public.delete_chat_for_everyone(uuid) from public, anon;
grant execute on function public.delete_chat_for_everyone(uuid) to authenticated;

notify pgrst, 'reload schema';
