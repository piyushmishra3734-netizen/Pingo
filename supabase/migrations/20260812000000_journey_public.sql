-- PINGO — the public half of Journey.
--
-- Opening somebody's profile should show what they have built here: their
-- level, and the badges they have earned. None of that can be worked out by the
-- person looking — Journey is counted on the owner's own device, from their own
-- cached messages, and nobody else can see those. So the owner publishes a
-- summary of it, and this table is that summary.
--
-- ## What is deliberately not in here
--
-- docs/journey-philosophy.md § 5 splits Journey in two. Public: level, joined,
-- recent badges. Private: today's missions, AI conversations, memories,
-- personal statistics, Pulse. Only the public half has a column.
--
-- No `moments`. A level is a milestone; a moment count is a score, and a score
-- on a profile is the leaderboard the whole document exists to avoid.
--
-- No metrics of any kind. Message counts, call minutes and who somebody talks
-- to never leave the device, and there is no column here that could hold them
-- even by accident.
--
-- ## Badge ids only
--
-- The row holds ids, not titles or descriptions: the client already has the
-- registry, and a copy of the words here would be a second source of truth that
-- drifts the first time a badge is renamed.

create table if not exists public.journey_public (
  user_id uuid primary key references public.profiles (id) on delete cascade,

  -- Milestone, not score. Clamped so a broken client cannot publish a level
  -- that the curve could never produce.
  level int not null default 1 check (level between 1 and 999),

  -- Earned badge ids, in the order the client sends them (newest last).
  badge_ids text[] not null default '{}',

  updated_at timestamptz not null default now(),

  -- A ceiling on the array, so this cannot become a place to store things.
  constraint journey_public_badges_sane check (array_length(badge_ids, 1) is null or array_length(badge_ids, 1) <= 200)
);

alter table public.journey_public enable row level security;

-- Anyone signed in may read anyone's public Journey. That is what "public"
-- means here, and it matches what the profile screen shows.
drop policy if exists journey_public_read on public.journey_public;
create policy journey_public_read
  on public.journey_public
  for select
  to authenticated
  using (true);

-- Only the owner may write their own row. Nobody can award anybody a badge,
-- which is the same rule the Real Life badges rely on from the other side.
drop policy if exists journey_public_write on public.journey_public;
create policy journey_public_write
  on public.journey_public
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists journey_public_update on public.journey_public;
create policy journey_public_update
  on public.journey_public
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop trigger if exists journey_public_touch_updated_at on public.journey_public;
create trigger journey_public_touch_updated_at
  before update on public.journey_public
  for each row execute function public.touch_updated_at();
