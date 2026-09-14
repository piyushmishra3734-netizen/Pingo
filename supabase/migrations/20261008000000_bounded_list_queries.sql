-- The chat list and streaks, bounded by what they show.
--
-- Both read every message in every conversation the caller belongs to, on every
-- list load: `conversation_previews` to find one newest message and an unread
-- count, `my_streaks` to group all of history by day. Measured 2026-09-14:
-- 1.2 s and 0.4 s mean, the two largest totals in pg_stat_statements, and the
-- statements still timing out once the old history repair was switched off.
--
-- Same signatures and the same answers; only how they are reached changes.

-- Newest: one index probe per conversation (conversation_id, created_at desc).
-- Unread: only the rows after the read cursor, not the whole thread.
create or replace function public.conversation_previews()
returns table(conversation_id uuid, last_message_id uuid, unread_count integer, archived_at timestamp with time zone, deleted boolean, muted boolean, muted_until timestamp with time zone, has_messages boolean)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    m.conversation_id,
    newest.id as last_message_id,
    case when m.marked_unread then greatest(unread.n, 1) else unread.n end as unread_count,
    m.archived_at,
    (
      m.deleted_at is not null
      and (newest.created_at is null or newest.created_at <= m.deleted_at)
    ) as deleted,
    -- Computed, so an expired mute is unmuted the instant it expires.
    (m.muted_until is not null and m.muted_until > now()) as muted,
    m.muted_until,
    -- Over the whole table, not the visible window: a cleared chat was real,
    -- and stays listed. Only a thread that never carried a message is false.
    exists (
      select 1 from public.messages ever
      where ever.conversation_id = m.conversation_id
    ) as has_messages
  from public.conversation_members m
  left join lateral (
    select msg.id, msg.created_at
    from public.messages msg
    where msg.conversation_id = m.conversation_id
      and (m.cleared_at is null or msg.created_at > m.cleared_at)
      and not exists (
        select 1 from public.hidden_messages h
        where h.message_id = msg.id and h.user_id = auth.uid()
      )
    order by msg.created_at desc
    limit 1
  ) newest on true
  cross join lateral (
    select count(*)::integer as n
    from public.messages v
    where v.conversation_id = m.conversation_id
      and v.sender_id <> auth.uid()
      and v.created_at > m.last_read_at
      and (m.cleared_at is null or v.created_at > m.cleared_at)
      and not exists (
        select 1 from public.hidden_messages h
        where h.message_id = v.id and h.user_id = auth.uid()
      )
  ) unread
  where m.user_id = auth.uid();
$$;

-- A streak is the run of mutual days ending today or yesterday. Walked back one
-- day at a time from there, stopping at the first missed day, instead of
-- grouping every message ever sent to find the same run.
create or replace function public.my_streaks()
returns table(conversation_id uuid, streak integer)
language sql
stable
security definer
set search_path to 'public'
as $$
  with recursive mine as (
    select c.id
    from public.conversations c
    join public.conversation_members m
      on m.conversation_id = c.id and m.user_id = auth.uid()
    where c.kind = 'direct'
  ),
  walk as (
    select mine.id as conversation_id, start.day, 1 as streak
    from mine
    cross join lateral (
      select d.day
      from (values ((now() at time zone 'utc')::date),
                   ((now() at time zone 'utc')::date - 1)) as d(day)
      -- A mutual day: at least two different senders that UTC day.
      where (
        select count(distinct msg.sender_id)
        from public.messages msg
        where msg.conversation_id = mine.id
          and msg.created_at >= (d.day::timestamp at time zone 'utc')
          and msg.created_at < ((d.day + 1)::timestamp at time zone 'utc')
      ) >= 2
      order by d.day desc
      limit 1
    ) start
    union all
    select w.conversation_id, w.day - 1, w.streak + 1
    from walk w
    where (
      select count(distinct msg.sender_id)
      from public.messages msg
      where msg.conversation_id = w.conversation_id
        and msg.created_at >= ((w.day - 1)::timestamp at time zone 'utc')
        and msg.created_at < (w.day::timestamp at time zone 'utc')
    ) >= 2
  )
  select conversation_id, max(streak)::integer as streak
  from walk
  group by conversation_id;
$$;
