-- delete_message says no, instead of quietly doing nothing.
--
-- Two refusals used to be a bare `return`: deleting for everyone somebody else's
-- message in a group, and deleting a message in a chat you are not in. The call
-- succeeded and nothing changed, so the app showed "deleted" for a message that
-- was still there, or "didn't work" with no reason.
--
-- Both now raise, with a sentence the app can show. What is allowed is exactly
-- what it was: your own message anywhere, anybody's in a one to one chat, and
-- "delete for me" for any message you can see. A message that is already gone
-- is still not an error, so deleting twice is harmless.

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
  -- Already gone, or never there: nothing to do, and asking twice is not an error.
  if m is null then
    return;
  end if;
  if not public.is_conversation_member(m.conversation_id) then
    raise exception 'You are not in this chat.';
  end if;

  if for_everyone then
    select c.kind into kind from public.conversations c where c.id = m.conversation_id;

    -- Your own, or anybody's in a one to one chat.
    if m.sender_id <> auth.uid() and kind is distinct from 'direct' then
      raise exception 'Only your own messages can be deleted for everyone here.';
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

notify pgrst, 'reload schema';
