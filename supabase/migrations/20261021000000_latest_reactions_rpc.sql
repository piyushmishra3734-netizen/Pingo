-- The chat list's "Reacted 😂 to your message", without burning the database.
--
-- The client asked PostgREST for it as two embedded selects
-- (message_reactions with messages!inner). Both tables are under RLS, so every
-- candidate row ran a membership check, and the planner walked every reaction
-- against every message: ~25,000 buffer reads a call, twice per chat-list
-- load. Measured 2026-10-06 they were the two most expensive statements on
-- the project - 170M buffer reads between them, more than everything else that
-- touches messages - and the chat list waited 300-450 ms on them.
--
-- One function instead: security definer, scoped to auth.uid() by hand, two
-- index-backed reads of at most 60 rows each, the last 14 days only, and one
-- row per conversation back.

create index if not exists message_reactions_user_recent_idx
  on public.message_reactions (user_id, created_at desc);
create index if not exists message_reactions_recent_idx
  on public.message_reactions (created_at desc);

create or replace function public.latest_reactions()
returns table (conversation_id uuid, message_id uuid, user_id uuid, emoji text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (m.conversation_id)
    m.conversation_id, r.message_id, r.user_id, r.emoji, r.created_at
  from (
    -- Mine, on anything.
    (select x.message_id, x.user_id, x.emoji, x.created_at
       from public.message_reactions x
      where x.user_id = auth.uid()
        and x.created_at > now() - interval '14 days'
      order by x.created_at desc
      limit 60)
    union all
    -- Theirs, on mine.
    (select x.message_id, x.user_id, x.emoji, x.created_at
       from public.message_reactions x
       join public.messages own on own.id = x.message_id
      where own.sender_id = auth.uid()
        and x.user_id <> auth.uid()
        and x.created_at > now() - interval '14 days'
      order by x.created_at desc
      limit 60)
  ) r
  join public.messages m on m.id = r.message_id
  where exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = m.conversation_id and cm.user_id = auth.uid()
  )
  order by m.conversation_id, r.created_at desc;
$$;

revoke execute on function public.latest_reactions() from public, anon;
grant execute on function public.latest_reactions() to authenticated;
