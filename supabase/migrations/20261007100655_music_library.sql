-- PINGO Music: what a person keeps, across their phones.
--
-- The catalogue itself is JioSaavn's (the pingo-saavn Worker); what is stored
-- here is only what belongs to the listener: the songs they liked, what they
-- played (which is what "for you" is built from), the artists they follow,
-- and playlists of their own.
--
-- A song is kept as the few fields a list row draws (name, artist, cover,
-- length) beside its JioSaavn id, so a library opens without asking the
-- catalogue anything. The address to play it is looked up fresh when it is
-- played: JioSaavn's addresses can change, ids do not.
--
-- Everything is private to its owner. Nobody else can read anyone's library.

create table if not exists public.music_likes (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  song_id text not null check (char_length(song_id) between 1 and 32),
  song jsonb not null check (jsonb_typeof(song) = 'object' and octet_length(song::text) <= 2048),
  liked_at timestamptz not null default now(),
  primary key (user_id, song_id)
);
create index if not exists music_likes_recent on public.music_likes (user_id, liked_at desc);

-- One row per song per person, bumped on every play: "recently played" and the
-- counts the taste profile is built from, without a row per play.
create table if not exists public.music_plays (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  song_id text not null check (char_length(song_id) between 1 and 32),
  song jsonb not null check (jsonb_typeof(song) = 'object' and octet_length(song::text) <= 2048),
  plays integer not null default 1 check (plays > 0),
  -- Plays that ran to (nearly) the end, against skips: a stronger signal than a tap.
  finished integer not null default 0 check (finished >= 0),
  last_played_at timestamptz not null default now(),
  primary key (user_id, song_id)
);
create index if not exists music_plays_recent on public.music_plays (user_id, last_played_at desc);

create table if not exists public.music_follows (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  artist_id text not null check (char_length(artist_id) between 1 and 32),
  artist jsonb not null check (jsonb_typeof(artist) = 'object' and octet_length(artist::text) <= 1024),
  followed_at timestamptz not null default now(),
  primary key (user_id, artist_id)
);

create table if not exists public.music_playlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists music_playlists_owner on public.music_playlists (user_id, updated_at desc);

create table if not exists public.music_playlist_songs (
  playlist_id uuid not null references public.music_playlists (id) on delete cascade,
  song_id text not null check (char_length(song_id) between 1 and 32),
  song jsonb not null check (jsonb_typeof(song) = 'object' and octet_length(song::text) <= 2048),
  position double precision not null,
  added_at timestamptz not null default now(),
  primary key (playlist_id, song_id)
);
create index if not exists music_playlist_songs_order on public.music_playlist_songs (playlist_id, position);

alter table public.music_likes enable row level security;
alter table public.music_plays enable row level security;
alter table public.music_follows enable row level security;
alter table public.music_playlists enable row level security;
alter table public.music_playlist_songs enable row level security;

drop policy if exists "own likes" on public.music_likes;
create policy "own likes" on public.music_likes for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "own plays" on public.music_plays;
create policy "own plays" on public.music_plays for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "own follows" on public.music_follows;
create policy "own follows" on public.music_follows for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "own playlists" on public.music_playlists;
create policy "own playlists" on public.music_playlists for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "own playlist songs" on public.music_playlist_songs;
create policy "own playlist songs" on public.music_playlist_songs for all to authenticated
  using (exists (select 1 from public.music_playlists p where p.id = playlist_id and p.user_id = auth.uid()))
  with check (exists (select 1 from public.music_playlists p where p.id = playlist_id and p.user_id = auth.uid()));

-- At most 200 playlists of 2000 songs each: enough for anyone, not a free database.
create or replace function public.music_playlist_limits() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'music_playlists' then
    if (select count(*) from public.music_playlists where user_id = new.user_id) >= 200 then
      raise exception 'Too many playlists';
    end if;
  else
    if (select count(*) from public.music_playlist_songs where playlist_id = new.playlist_id) >= 2000 then
      raise exception 'This playlist is full';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists music_playlists_limit on public.music_playlists;
create trigger music_playlists_limit before insert on public.music_playlists
  for each row execute function public.music_playlist_limits();
drop trigger if exists music_playlist_songs_limit on public.music_playlist_songs;
create trigger music_playlist_songs_limit before insert on public.music_playlist_songs
  for each row execute function public.music_playlist_limits();

-- A play, counted in one round trip: insert the first time, bump after.
create or replace function public.music_record_play(p_song_id text, p_song jsonb, p_finished boolean)
returns void language sql security invoker set search_path = public as $$
  insert into public.music_plays (user_id, song_id, song, plays, finished, last_played_at)
  values (auth.uid(), p_song_id, p_song, 1, case when p_finished then 1 else 0 end, now())
  on conflict (user_id, song_id) do update
    set plays = public.music_plays.plays + 1,
        finished = public.music_plays.finished + case when p_finished then 1 else 0 end,
        song = excluded.song,
        last_played_at = now();
$$;

revoke all on function public.music_record_play(text, jsonb, boolean) from public, anon;
grant execute on function public.music_record_play(text, jsonb, boolean) to authenticated;
revoke all on function public.music_playlist_limits() from public, anon, authenticated;

grant select, insert, update, delete on public.music_likes, public.music_plays, public.music_follows, public.music_playlists, public.music_playlist_songs to authenticated;
