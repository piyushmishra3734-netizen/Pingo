create schema if not exists auth; create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create table public.profiles (id uuid primary key references auth.users(id), username text, display_name text, avatar_url text);
create table public.close_friends (owner_id uuid, friend_id uuid);
create table public.follows (follower_id uuid, followee_id uuid, status text);
create function public.is_mutual(other uuid) returns boolean language sql security definer stable as $$
  select exists (select 1 from public.follows a join public.follows b on b.follower_id=a.followee_id and b.followee_id=a.follower_id
   where a.follower_id=auth.uid() and a.followee_id=other and a.status='accepted' and b.status='accepted') $$;
do $$ begin if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if; if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if; end $$;
grant usage on schema public, auth to authenticated, anon;
