-- Display-only seeds for profile Friends / Groups counts.
--
-- These inflate the *numbers shown* on a profile. They are never used for:
--   mutual gates, calls, follows, member lists, badges, or any product logic.
-- Real relationships stay real; the seed is only added inside profile_stats.
--
-- Clients cannot raise their own seeds: the preserve trigger freezes the
-- columns whenever auth.uid() is present (normal app traffic). Operators set
-- them with SQL as postgres / service role without a user JWT:
--
--   update public.profiles
--   set friends_display_seed = 150, groups_display_seed = 12
--   where username = 'someone';

alter table public.profiles
  add column if not exists friends_display_seed integer not null default 0
    check (friends_display_seed >= 0),
  add column if not exists groups_display_seed integer not null default 0
    check (groups_display_seed >= 0);

comment on column public.profiles.friends_display_seed is
  'Display-only offset added to real mutual-friend count in profile_stats. Not used for product logic.';
comment on column public.profiles.groups_display_seed is
  'Display-only offset added to real group membership count in profile_stats. Not used for product logic.';

-- App users may update their own profile row, but never these two columns.
create or replace function public.profiles_preserve_display_seeds()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is not null then
    new.friends_display_seed := old.friends_display_seed;
    new.groups_display_seed := old.groups_display_seed;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_preserve_display_seeds on public.profiles;
create trigger profiles_preserve_display_seeds
  before update on public.profiles
  for each row
  execute function public.profiles_preserve_display_seeds();

-- Re-define stats: real counts + seeds. Everything else in the product still
-- counts only real follows / memberships.
create or replace function public.profile_stats(target uuid)
returns table (posts integer, friends integer, groups integer)
language sql
security definer
set search_path = public
stable
as $$
  select
    (select count(*) from public.posts p where p.author_id = target)::int,
    (
      (
        select count(*)
        from public.follows a
        join public.follows b
          on b.follower_id = a.followee_id and b.followee_id = a.follower_id
        where a.follower_id = target
          and a.status = 'accepted'
          and b.status = 'accepted'
      )::int
      + coalesce(
        (select p.friends_display_seed from public.profiles p where p.id = target),
        0
      )
    ),
    (
      (
        select count(*)
        from public.conversation_members m
        join public.conversations c on c.id = m.conversation_id
        where m.user_id = target and c.kind in ('group', 'community')
      )::int
      + coalesce(
        (select p.groups_display_seed from public.profiles p where p.id = target),
        0
      )
    );
$$;

revoke all on function public.profile_stats(uuid) from public;
grant execute on function public.profile_stats(uuid) to authenticated;
