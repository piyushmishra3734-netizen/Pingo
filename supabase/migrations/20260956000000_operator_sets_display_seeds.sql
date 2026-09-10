-- Display seeds, set from the Controlling screen instead of raw SQL.
--
-- Same shape as set_premium: a SECURITY DEFINER function behind is_ai_owner().
-- The preserve trigger froze the columns for any request carrying a JWT, which
-- also froze the operator's own RPC, so it now lets the operator through and
-- still freezes everyone else.

create or replace function public.profiles_preserve_display_seeds()
returns trigger
language plpgsql
as $$
begin
  -- Nested so is_ai_owner() only runs for requests carrying a user JWT.
  if auth.uid() is not null then
    if not public.is_ai_owner() then
      new.friends_display_seed := old.friends_display_seed;
      new.groups_display_seed := old.groups_display_seed;
    end if;
  end if;
  return new;
end;
$$;

-- A null leaves that seed as it is. Returns the seeds now in place.
create or replace function public.set_display_seeds(
  target uuid,
  new_friends integer,
  new_groups integer
)
returns table (friends integer, groups integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_ai_owner() then
    raise exception 'Only the operator can set display seeds.';
  end if;
  return query
    update public.profiles p
    set friends_display_seed = coalesce(new_friends, p.friends_display_seed),
        groups_display_seed = coalesce(new_groups, p.groups_display_seed),
        updated_at = now()
    where p.id = target
    returning p.friends_display_seed, p.groups_display_seed;
end;
$$;

revoke all on function public.set_display_seeds(uuid, integer, integer) from public, anon;
grant execute on function public.set_display_seeds(uuid, integer, integer) to authenticated;
