-- Profile redesign: two short lines under the bio, and "Friends with ..." on
-- somebody else's profile.

-- ---------------------------------------------------------------------------
-- Work and location
-- ---------------------------------------------------------------------------

-- Free text, public like the bio, and both optional: an empty one is simply not
-- drawn. Forty characters is a job title or a city, not a second bio.
alter table public.profiles
  add column if not exists work text,
  add column if not exists location text;

alter table public.profiles drop constraint if exists profiles_work_length;
alter table public.profiles
  add constraint profiles_work_length check (char_length(work) <= 40);

alter table public.profiles drop constraint if exists profiles_location_length;
alter table public.profiles
  add constraint profiles_location_length check (char_length(location) <= 40);

-- Added to the column grant rather than re-granting the whole list: the list
-- lives in 20260947000000 and repeating it here would be a second copy to drift.
grant update (work, location) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Mutual friends
-- ---------------------------------------------------------------------------

-- `follows` is only readable where the caller is one side of the row, so
-- nobody can list somebody else's friends - and this does not change that. It
-- answers one narrower question, only about the caller: which of *my* friends
-- are also friends with this person. Up to three faces and the total, which is
-- exactly what the line on a profile shows.
create or replace function public.mutual_friends(other uuid)
returns table (total integer, id uuid, display_name text, avatar_url text)
language sql
security definer
set search_path = public
stable
as $$
  with mine as (
    select a.followee_id as friend
    from public.follows a
    join public.follows b
      on b.follower_id = a.followee_id and b.followee_id = a.follower_id
    where a.follower_id = auth.uid() and a.status = 'accepted' and b.status = 'accepted'
  ),
  theirs as (
    select a.followee_id as friend
    from public.follows a
    join public.follows b
      on b.follower_id = a.followee_id and b.followee_id = a.follower_id
    where a.follower_id = other and a.status = 'accepted' and b.status = 'accepted'
  )
  select (count(*) over ())::int, p.id, p.display_name, p.avatar_url
  from mine
  join theirs on theirs.friend = mine.friend
  join public.profiles p on p.id = mine.friend
  where auth.uid() is not null
    and other <> auth.uid()
    and mine.friend not in (other, auth.uid())
  order by p.display_name
  limit 3;
$$;

revoke all on function public.mutual_friends(uuid) from public, anon;
grant execute on function public.mutual_friends(uuid) to authenticated;
