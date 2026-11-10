-- PINGO AI's own thread is a built-in tool, not somebody's chat: it cannot be
-- archived. The app no longer offers it; this is the part an older build cannot
-- get around, and it refuses quietly (the column stays null) so nothing errors.
--
-- A side chat with PINGO AI (conversations.ai_side) can still be archived.
-- Four people had archived theirs by swipe before this; those are put back.

create or replace function public.ai_chat_not_archivable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.archived_at is not null and exists (
    select 1 from public.conversations c
     where c.id = new.conversation_id and c.kind = 'ai' and not c.ai_side
  ) then
    new.archived_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists ai_chat_not_archivable on public.conversation_members;
create trigger ai_chat_not_archivable
  before insert or update of archived_at on public.conversation_members
  for each row execute function public.ai_chat_not_archivable();

update public.conversation_members m
   set archived_at = null
  from public.conversations c
 where c.id = m.conversation_id and c.kind = 'ai' and not c.ai_side
   and m.archived_at is not null;
