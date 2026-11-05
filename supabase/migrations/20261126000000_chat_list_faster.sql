-- The chat list was slow in the database, not on the network.
--
-- Supabase's own logs showed it: a typical request takes 30-100 ms, but a long
-- tail takes 1-8 seconds, on every table alike. The tail is queueing. Opening
-- the app fires three calls together - conversation_previews, my_streaks and
-- latest_reactions - and between them they held a database connection for
-- ~850 ms. With a small connection pool, everybody else's requests wait behind
-- them.
--
-- Measured for the account with the most chats (51), before -> after:
--   conversation_previews   134 ms -> 10 ms
--   my_streaks              278 ms ->  6 ms
--
-- The answers are exactly the same. Two things were slow, and neither changes
-- what is returned:
--
-- 1. `auth.uid()` was called once per ROW inside the inner queries (every
--    message looked at, every hidden-message check). It is not free: it parses
--    the request's JWT claims as JSON each time. It is now read once, in a
--    one-row CTE, and the rest compare against that.
--
-- 2. my_streaks counted every message of every day of every direct chat, to
--    learn whether two people had spoken. Now:
--      - a chat with no message since yesterday cannot have a streak (a streak
--        is "both of you wrote today or yesterday"), so it is skipped with one
--        index probe;
--      - "two different people wrote that day" is asked as "is there a message
--        from somebody other than the first sender", which stops at the first
--        one instead of counting them all.
--
-- latest_reactions gets only the first change. All three keep their names,
-- arguments, columns and grants.

create or replace function public.conversation_previews(only_ids uuid[])
returns table(
  conversation_id uuid,
  last_message_id uuid,
  unread_count integer,
  archived_at timestamp with time zone,
  deleted boolean,
  muted boolean,
  muted_until timestamp with time zone,
  has_messages boolean
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with me as materialized (select auth.uid() as id)
  select
    m.conversation_id,
    newest.id as last_message_id,
    case when m.marked_unread then greatest(unread.n, 1) else unread.n end as unread_count,
    m.archived_at,
    (
      m.deleted_at is not null
      and (newest.created_at is null or newest.created_at <= m.deleted_at)
    ) as deleted,
    (m.muted_until is not null and m.muted_until > now()) as muted,
    m.muted_until,
    exists (
      select 1 from public.messages ever
      where ever.conversation_id = m.conversation_id
    ) as has_messages
  from me
  join public.conversation_members m on m.user_id = me.id
  left join lateral (
    select msg.id, msg.created_at
    from public.messages msg
    where msg.conversation_id = m.conversation_id
      and (m.cleared_at is null or msg.created_at > m.cleared_at)
      and not exists (
        select 1 from public.hidden_messages h
        where h.message_id = msg.id and h.user_id = me.id
      )
    order by msg.created_at desc
    limit 1
  ) newest on true
  cross join lateral (
    select count(*)::integer as n
    from public.messages v
    where v.conversation_id = m.conversation_id
      and v.sender_id <> me.id
      and v.created_at > m.last_read_at
      and (m.cleared_at is null or v.created_at > m.cleared_at)
      and not exists (
        select 1 from public.hidden_messages h
        where h.message_id = v.id and h.user_id = me.id
      )
  ) unread
  where (only_ids is null or m.conversation_id = any(only_ids));
$$;

-- Whether two different people wrote in a chat on one UTC day. Internal: only
-- my_streaks calls it, so nobody is handed a way to ask about other people's chats.
create or replace function public.streak_day_mutual(p_conv uuid, p_day date)
returns boolean
language sql
stable
set search_path to 'public'
as $$
  select exists (
    select 1 from public.messages b
    where b.conversation_id = p_conv
      and b.created_at >= (p_day::timestamp at time zone 'utc')
      and b.created_at <  ((p_day + 1)::timestamp at time zone 'utc')
      and b.sender_id <> (
        select a.sender_id from public.messages a
        where a.conversation_id = p_conv
          and a.created_at >= (p_day::timestamp at time zone 'utc')
          and a.created_at <  ((p_day + 1)::timestamp at time zone 'utc')
        order by a.created_at, a.id
        limit 1
      )
  );
$$;
revoke all on function public.streak_day_mutual(uuid, date) from public, anon, authenticated;

create or replace function public.my_streaks(only_ids uuid[])
returns table(conversation_id uuid, streak integer)
language sql
stable
security definer
set search_path to 'public'
as $$
  with recursive me as materialized (select auth.uid() as id),
  mine as (
    select c.id
    from public.conversations c
    join public.conversation_members m on m.conversation_id = c.id
    cross join me
    where m.user_id = me.id
      and c.kind = 'direct'
      and (only_ids is null or c.id = any(only_ids))
      -- No message since yesterday (UTC): there is no streak to find.
      and exists (
        select 1 from public.messages r
        where r.conversation_id = c.id
          and r.created_at >= (((now() at time zone 'utc')::date - 1)::timestamp at time zone 'utc')
      )
  ),
  walk as (
    select mine.id as conversation_id, start.day, 1 as streak
    from mine
    cross join lateral (
      select d.day
      from (values ((now() at time zone 'utc')::date),
                   ((now() at time zone 'utc')::date - 1)) as d(day)
      where public.streak_day_mutual(mine.id, d.day)
      order by d.day desc
      limit 1
    ) start
    union all
    select w.conversation_id, w.day - 1, w.streak + 1
    from walk w
    where public.streak_day_mutual(w.conversation_id, w.day - 1)
  )
  select conversation_id, max(streak)::integer as streak
  from walk
  group by conversation_id;
$$;

create or replace function public.latest_reactions()
returns table(conversation_id uuid, message_id uuid, user_id uuid, emoji text, created_at timestamp with time zone)
language sql
stable
security definer
set search_path to 'public'
as $$
  with me as materialized (select auth.uid() as id)
  select distinct on (m.conversation_id)
    m.conversation_id, r.message_id, r.user_id, r.emoji, r.created_at
  from me, lateral (
    -- Mine, on anything.
    (select x.message_id, x.user_id, x.emoji, x.created_at
       from public.message_reactions x
      where x.user_id = me.id
        and x.created_at > now() - interval '14 days'
      order by x.created_at desc
      limit 60)
    union all
    -- Theirs, on mine.
    (select x.message_id, x.user_id, x.emoji, x.created_at
       from public.message_reactions x
       join public.messages own on own.id = x.message_id
      where own.sender_id = me.id
        and x.user_id <> me.id
        and x.created_at > now() - interval '14 days'
      order by x.created_at desc
      limit 60)
  ) r
  join public.messages m on m.id = r.message_id
  where exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = m.conversation_id and cm.user_id = me.id
  )
  order by m.conversation_id, r.created_at desc;
$$;
