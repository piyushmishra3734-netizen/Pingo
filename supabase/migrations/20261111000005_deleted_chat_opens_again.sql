-- A chat you deleted must open again when you go to it.
--
-- Searching for the person, or opening their profile and pressing Message, calls
-- `start_direct_conversation`, which found the old conversation and handed back
-- its id - while the member row still said `deleted_at`. The chat list treats
-- that as "gone", so the app found nothing to open and showed nothing.
--
-- Going to somebody is the opposite of deleting the chat: take the delete mark
-- off. The history stays behind `cleared_at`, so it opens empty and the first
-- message starts it again.

create or replace function public.start_direct_conversation(other_user uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  conv uuid;
begin
  if me is null then
    raise exception 'not authenticated';
  end if;

  if other_user = me then
    raise exception 'cannot start a conversation with yourself';
  end if;

  if not exists (select 1 from public.profiles p where p.id = other_user) then
    raise exception 'no such user';
  end if;

  select c.id into conv
  from public.conversations c
  join public.conversation_members mine on mine.conversation_id = c.id and mine.user_id = me
  join public.conversation_members theirs on theirs.conversation_id = c.id and theirs.user_id = other_user
  where c.kind = 'direct'
  limit 1;

  if conv is not null then
    update public.conversation_members
       set deleted_at = null
     where conversation_id = conv
       and user_id = me
       and deleted_at is not null;
    return conv;
  end if;

  insert into public.conversations (kind, created_by)
  values ('direct', me)
  returning id into conv;

  insert into public.conversation_members (conversation_id, user_id)
  values (conv, me), (conv, other_user);

  return conv;
end;
$$;
