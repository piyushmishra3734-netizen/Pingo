-- PINGO AI's own thread is a built-in tool, not somebody's chat: it cannot be
-- archived or muted. The app no longer offers either; this is the part an older
-- build cannot get around, and it refuses quietly (the columns stay null) so
-- nothing errors. Deleting it stays up to the person, and a new one is made.
--
-- A side chat with PINGO AI (conversations.ai_side) can still be archived and
-- muted. Anyone who had archived or muted theirs before this is put back.

create or replace function public.ai_chat_is_a_tool()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.archived_at is not null or new.muted_until is not null) and exists (
    select 1 from public.conversations c
     where c.id = new.conversation_id and c.kind = 'ai' and not c.ai_side
  ) then
    new.archived_at := null;
    new.muted_until := null;
  end if;
  return new;
end;
$$;

drop trigger if exists ai_chat_not_archivable on public.conversation_members;
drop function if exists public.ai_chat_not_archivable();
drop trigger if exists ai_chat_is_a_tool on public.conversation_members;
create trigger ai_chat_is_a_tool
  before insert or update of archived_at, muted_until on public.conversation_members
  for each row execute function public.ai_chat_is_a_tool();

update public.conversation_members m
   set archived_at = null, muted_until = null
  from public.conversations c
 where c.id = m.conversation_id and c.kind = 'ai' and not c.ai_side
   and (m.archived_at is not null or m.muted_until is not null);
