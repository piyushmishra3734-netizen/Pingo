-- Stop notifying about plain messages.
--
-- A message already announces itself: the thread moves to the top of the list
-- with an unread count on it, and the dock carries that count too. A second
-- entry in the feed saying the same thing turns the feed into a duplicate of
-- the chat list — and buries the things that only live there, like a follow
-- request waiting on you.
--
-- Snaps stay. A snap can be opened twice and then never again, so missing one
-- is losing it, and it has no unread badge of its own to fall back on.

create or replace function public.on_message_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  member record;
begin
  -- Text messages are represented by the chat list, not by the feed.
  if new.kind <> 'snap' then
    return new;
  end if;

  for member in
    select user_id from public.conversation_members
    where conversation_id = new.conversation_id and user_id <> new.sender_id
  loop
    perform public.notify_user(member.user_id, new.sender_id, 'snap', new.conversation_id);
  end loop;

  return new;
end;
$$;

-- Clear the ones already written, or the feed stays full of them for a day.
delete from public.notifications where kind = 'message';
