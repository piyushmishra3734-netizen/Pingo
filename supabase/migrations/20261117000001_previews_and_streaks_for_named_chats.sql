-- The chat list's per-conversation reads answer for the chats named, not all.
--
-- `conversation_previews()` and `my_streaks()` take no arguments, so they
-- answer for the whole account however few conversations the caller is
-- hydrating. The list now patches only the chats that changed (#patchList),
-- and each patch still paid for every chat: 10.8 kB of previews for an account
-- with fifty, to refresh one.
--
-- Each gains an overload naming the conversations. The zero-argument versions
-- stay - older app builds call them - and become the overload with `null`,
-- which means "all of mine", so there is one body to keep right.

create or replace function public.conversation_previews(only_ids uuid[])
returns table (
  conversation_id uuid,
  last_message_id uuid,
  unread_count integer,
  archived_at timestamptz,
  deleted boolean,
  muted boolean,
  muted_until timestamptz,
  has_messages boolean
)
language sql
stable
security definer
set search_path = public
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
    (m.muted_until is not null and m.muted_until > now()) as muted,
    m.muted_until,
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
  where m.user_id = auth.uid()
    and (only_ids is null or m.conversation_id = any(only_ids));
$$;

create or replace function public.conversation_previews()
returns table (
  conversation_id uuid,
  last_message_id uuid,
  unread_count integer,
  archived_at timestamptz,
  deleted boolean,
  muted boolean,
  muted_until timestamptz,
  has_messages boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select * from public.conversation_previews(null::uuid[]);
$$;

create or replace function public.my_streaks(only_ids uuid[])
returns table (conversation_id uuid, streak integer)
language sql
stable
security definer
set search_path = public
as $$
  with recursive mine as (
    select c.id
    from public.conversations c
    join public.conversation_members m
      on m.conversation_id = c.id and m.user_id = auth.uid()
    where c.kind = 'direct'
      and (only_ids is null or c.id = any(only_ids))
  ),
  walk as (
    select mine.id as conversation_id, start.day, 1 as streak
    from mine
    cross join lateral (
      select d.day
      from (values ((now() at time zone 'utc')::date),
                   ((now() at time zone 'utc')::date - 1)) as d(day)
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

create or replace function public.my_streaks()
returns table (conversation_id uuid, streak integer)
language sql
stable
security definer
set search_path = public
as $$
  select * from public.my_streaks(null::uuid[]);
$$;

revoke all on function public.conversation_previews(uuid[]) from public, anon;
grant execute on function public.conversation_previews(uuid[]) to authenticated;
revoke all on function public.my_streaks(uuid[]) from public, anon;
grant execute on function public.my_streaks(uuid[]) to authenticated;
