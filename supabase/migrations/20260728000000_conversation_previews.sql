-- One preview per conversation, computed by the database.
--
-- ## The bug this replaces
--
-- The client built every row's preview from "the newest 200 messages across all
-- of my conversations", filtered by conversation id. That works only while the
-- total stays under two hundred. Past it the newest 200 all belong to whichever
-- one or two threads are busy, every other conversation matches nothing, and
-- the list says "No messages yet" about a conversation full of messages. The
-- unread count came out of the same truncated set, so it silently went to zero
-- at the same moment.
--
-- It is the same shape of bug as the thread stopping at fifty messages: a limit
-- chosen for one query, doing duty as an answer to a different question.
--
-- ## Why this is a function and not a view
--
-- The interesting part is "the newest message *per* conversation", which is a
-- `distinct on` — something PostgREST cannot express against a table. Pushing
-- it into SQL also means the unread count is a `count(*)` over the real rows
-- rather than over whatever the client happened to have fetched.
--
-- `security definer` with `auth.uid()` in the join: a caller only ever gets
-- rows for conversations they belong to, and cannot ask about anyone else's.

create or replace function public.conversation_previews()
returns table (
  conversation_id uuid,
  last_message_id uuid,
  unread_count integer
)
language sql
security definer
set search_path = public
stable
as $$
  with mine as (
    select m.conversation_id, m.last_read_at
    from public.conversation_members m
    where m.user_id = auth.uid()
  ),
  newest as (
    select distinct on (msg.conversation_id)
      msg.conversation_id,
      msg.id
    from public.messages msg
    join mine on mine.conversation_id = msg.conversation_id
    -- Messages this reader deleted for themselves are not their newest.
    where not exists (
      select 1 from public.hidden_messages h
      where h.message_id = msg.id and h.user_id = auth.uid()
    )
    order by msg.conversation_id, msg.created_at desc
  ),
  unread as (
    select
      mine.conversation_id,
      count(msg.id)::integer as unread_count
    from mine
    left join public.messages msg
      on msg.conversation_id = mine.conversation_id
      -- Your own messages are never unread to you.
      and msg.sender_id <> auth.uid()
      and msg.created_at > mine.last_read_at
    group by mine.conversation_id
  )
  select
    mine.conversation_id,
    newest.id as last_message_id,
    coalesce(unread.unread_count, 0) as unread_count
  from mine
  left join newest on newest.conversation_id = mine.conversation_id
  left join unread on unread.conversation_id = mine.conversation_id;
$$;

revoke all on function public.conversation_previews() from public;
grant execute on function public.conversation_previews() to authenticated;

-- The list orders by this and the thread pages backwards through it, so both
-- reads want it indexed together with the conversation.
create index if not exists messages_conversation_created_desc_idx
  on public.messages (conversation_id, created_at desc, id);
