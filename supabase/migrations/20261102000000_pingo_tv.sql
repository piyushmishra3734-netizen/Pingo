-- PINGO TV: Watchlist and playback history storage
-- Project ref: gpijpmepzowwhvgkriqu

-- 1. Watchlist table
create table if not exists public.pingo_tv_watchlist (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  media_id text not null,
  media_type text not null check (media_type in ('movie', 'tv')),
  title text not null,
  poster_path text,
  backdrop_path text,
  overview text,
  rating numeric(3,1),
  release_year text,
  created_at timestamptz not null default now(),
  constraint pingo_tv_watchlist_user_media_uniq unique (user_id, media_id, media_type)
);

-- Index for speedy watchlist lookups per user
create index if not exists idx_pingo_tv_watchlist_user on public.pingo_tv_watchlist (user_id, created_at desc);

-- Enable Row Level Security (Mandatory)
alter table public.pingo_tv_watchlist enable row level security;

-- Policies: Authenticated users can manage only their own watchlist
create policy "Users can select own watchlist"
  on public.pingo_tv_watchlist for select
  using (user_id = auth.uid());

create policy "Users can insert own watchlist"
  on public.pingo_tv_watchlist for insert
  with check (user_id = auth.uid());

create policy "Users can update own watchlist"
  on public.pingo_tv_watchlist for update
  using (user_id = auth.uid());

create policy "Users can delete own watchlist"
  on public.pingo_tv_watchlist for delete
  using (user_id = auth.uid());

-- Explicit Grants: Required in PINGO because new tables receive no default privileges
grant select, insert, update, delete on public.pingo_tv_watchlist to authenticated;

-- 2. Playback / Continue Watching history table
create table if not exists public.pingo_tv_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  media_id text not null,
  media_type text not null check (media_type in ('movie', 'tv')),
  title text not null,
  poster_path text,
  backdrop_path text,
  progress_seconds integer not null default 0,
  duration_seconds integer not null default 0,
  last_watched_at timestamptz not null default now(),
  constraint pingo_tv_history_user_media_uniq unique (user_id, media_id, media_type)
);

-- Index for continue-watching sorting
create index if not exists idx_pingo_tv_history_user on public.pingo_tv_history (user_id, last_watched_at desc);

-- Enable Row Level Security (Mandatory)
alter table public.pingo_tv_history enable row level security;

-- Policies: Authenticated users can manage only their own watch history
create policy "Users can select own history"
  on public.pingo_tv_history for select
  using (user_id = auth.uid());

create policy "Users can insert own history"
  on public.pingo_tv_history for insert
  with check (user_id = auth.uid());

create policy "Users can update own history"
  on public.pingo_tv_history for update
  using (user_id = auth.uid());

create policy "Users can delete own history"
  on public.pingo_tv_history for delete
  using (user_id = auth.uid());

-- Explicit Grants
grant select, insert, update, delete on public.pingo_tv_history to authenticated;
