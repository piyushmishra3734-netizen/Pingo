-- PINGO — stories and streaks.
--
-- Two features that share a screen and nothing else: a story is ephemeral media
-- on the home row, a streak is a derived number beside a name. They ship in one
-- migration because they land on one screen, not because they are related.

-- ---------------------------------------------------------------------------
-- Stories
-- ---------------------------------------------------------------------------

create table if not exists public.stories (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users (id) on delete cascade,
  media_url text not null,
  created_at timestamptz not null default now(),
  -- Stored rather than computed, so the lifetime is a property of the row and
  -- a future "24h vs 48h" choice does not need a migration to express.
  expires_at timestamptz not null default now() + interval '24 hours'
);

create index if not exists stories_author_created_idx
  on public.stories (author_id, created_at desc);

create index if not exists stories_expiry_idx on public.stories (expires_at);

create table if not exists public.story_views (
  story_id uuid not null references public.stories (id) on delete cascade,
  viewer_id uuid not null references auth.users (id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (story_id, viewer_id)
);

alter table public.stories enable row level security;
alter table public.story_views enable row level security;

-- Expired stories are invisible at the database, not merely filtered in the
-- client. A story that has aged out should not be reachable by anyone who
-- writes their own query against the API.
drop policy if exists "live stories are readable" on public.stories;
create policy "live stories are readable"
  on public.stories for select
  to authenticated
  using (expires_at > now());

drop policy if exists "authors post their own stories" on public.stories;
create policy "authors post their own stories"
  on public.stories for insert
  to authenticated
  with check (author_id = auth.uid());

drop policy if exists "authors delete their own stories" on public.stories;
create policy "authors delete their own stories"
  on public.stories for delete
  to authenticated
  using (author_id = auth.uid());

-- A view is a private fact between one viewer and one story. Authors get counts
-- through a function later; nobody reads anyone else's view rows.
drop policy if exists "viewers record their own views" on public.story_views;
create policy "viewers record their own views"
  on public.story_views for insert
  to authenticated
  with check (viewer_id = auth.uid());

drop policy if exists "viewers read their own views" on public.story_views;
create policy "viewers read their own views"
  on public.story_views for select
  to authenticated
  using (viewer_id = auth.uid());

-- Story media. Same per-user folder rule as avatars.
insert into storage.buckets (id, name, public)
values ('stories', 'stories', true)
on conflict (id) do nothing;

drop policy if exists "story media is publicly readable" on storage.objects;
create policy "story media is publicly readable"
  on storage.objects for select
  using (bucket_id = 'stories');

drop policy if exists "users upload their own story media" on storage.objects;
create policy "users upload their own story media"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'stories'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------------------------------------------------------------------------
-- Streaks
-- ---------------------------------------------------------------------------
--
-- A streak is **consecutive days on which both people sent at least one
-- message.** One-sided days do not count, which is the whole point: a streak
-- measures a conversation, not persistence.
--
-- Derived rather than stored. A `streak_count` column would need a trigger on
-- every insert, a nightly job to expire stale ones, and would still drift the
-- first time either ran late. Computing it from `messages` cannot drift,
-- because the messages *are* the truth.
--
-- Days are UTC. Local-day boundaries would make a streak depend on who is
-- travelling, and two people in different zones would disagree about the number
-- they are both looking at.

create or replace function public.my_streaks()
returns table (conversation_id uuid, streak integer)
language sql
security definer
set search_path = public
stable
as $$
  with mine as (
    select c.id
    from public.conversations c
    join public.conversation_members m
      on m.conversation_id = c.id and m.user_id = auth.uid()
    where c.kind = 'direct'
  ),
  -- Days where the message senders number at least two: a mutual day.
  mutual_days as (
    select msg.conversation_id, (msg.created_at at time zone 'utc')::date as day
    from public.messages msg
    join mine on mine.id = msg.conversation_id
    group by msg.conversation_id, (msg.created_at at time zone 'utc')::date
    having count(distinct msg.sender_id) >= 2
  ),
  -- Gaps and islands: subtracting a dense rank from the date leaves one
  -- constant per run of consecutive days.
  runs as (
    select
      conversation_id,
      day,
      day - (row_number() over (partition by conversation_id order by day))::integer as run_key
    from mutual_days
  ),
  islands as (
    select conversation_id, run_key, count(*)::integer as length, max(day) as last_day
    from runs
    group by conversation_id, run_key
  )
  select conversation_id, length
  from islands
  -- Yesterday still counts: a streak should survive until the day is actually
  -- missed, not break the moment midnight passes.
  where last_day >= (now() at time zone 'utc')::date - 1;
$$;
