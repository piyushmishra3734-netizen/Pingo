-- Pingo TV: which server actually played a title, learnt from the people who watched it.
--
-- Most of Pingo TV's servers are other people's web pages in a frame. From the
-- browser there is no way to see whether the film is really in there, so the
-- automatic choice used to guess. Now every viewer's experience counts once:
-- a server they kept watching for two minutes "worked", one they left within
-- ninety seconds for another "failed". The next person who opens that title
-- starts on the server that worked for others.
--
-- One vote per person per title/episode/server (they can change it), so one
-- account cannot outvote everyone. Nothing here says who watched what to anyone
-- else: the table is closed, and the only read is a count per server.

create table if not exists public.tv_source_votes (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  media_type text        not null check (media_type in ('movie', 'tv')),
  tmdb_id    integer     not null check (tmdb_id > 0),
  season     smallint    not null default 0 check (season >= 0),
  episode    smallint    not null default 0 check (episode >= 0),
  source     text        not null check (source ~ '^[a-z0-9-]{2,32}$'),
  worked     boolean     not null,
  voted_at   timestamptz not null default now(),
  primary key (user_id, media_type, tmdb_id, season, episode, source)
);

create index if not exists tv_source_votes_title_idx
  on public.tv_source_votes (media_type, tmdb_id, season, episode);

alter table public.tv_source_votes enable row level security;
-- No policies: nobody reads or writes the table directly. The two functions below are the only way in.
revoke all on public.tv_source_votes from anon, authenticated;

create or replace function public.tv_source_vote(
  p_media_type text,
  p_tmdb_id integer,
  p_season integer,
  p_episode integer,
  p_source text,
  p_worked boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'sign in to vote' using errcode = '42501';
  end if;
  insert into public.tv_source_votes (user_id, media_type, tmdb_id, season, episode, source, worked)
  values (auth.uid(), p_media_type, p_tmdb_id, greatest(coalesce(p_season, 0), 0), greatest(coalesce(p_episode, 0), 0), p_source, p_worked)
  on conflict (user_id, media_type, tmdb_id, season, episode, source)
  do update set worked = excluded.worked, voted_at = now();
end;
$$;

-- Per server: how many people it worked for and how many it failed, for one title (and episode).
create or replace function public.tv_source_scores(
  p_media_type text,
  p_tmdb_id integer,
  p_season integer,
  p_episode integer
) returns table (source text, worked integer, failed integer)
language sql
stable
security definer
set search_path = public
as $$
  select v.source,
         count(*) filter (where v.worked)::integer,
         count(*) filter (where not v.worked)::integer
  from public.tv_source_votes v
  where v.media_type = p_media_type
    and v.tmdb_id = p_tmdb_id
    and v.season = greatest(coalesce(p_season, 0), 0)
    and v.episode = greatest(coalesce(p_episode, 0), 0)
  group by v.source;
$$;

revoke all on function public.tv_source_vote(text, integer, integer, integer, text, boolean) from public, anon;
grant execute on function public.tv_source_vote(text, integer, integer, integer, text, boolean) to authenticated;
revoke all on function public.tv_source_scores(text, integer, integer, integer) from public;
grant execute on function public.tv_source_scores(text, integer, integer, integer) to anon, authenticated;
