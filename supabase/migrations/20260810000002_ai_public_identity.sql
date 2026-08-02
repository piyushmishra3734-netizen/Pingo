-- Global PINGO AI face (name, bio, avatar) lives on the fixed bot profile.
-- Everyone reads it. Only allowlisted owners can write it via RPC so the
-- face is the same for every user by default.

create or replace function public.is_ai_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and lower(p.username) in ('piuxxh')
  );
$$;

revoke all on function public.is_ai_owner() from public;
grant execute on function public.is_ai_owner() to authenticated;

-- Seed a calm default bio if empty.
update public.profiles
set bio = coalesce(
  nullif(trim(bio), ''),
  'Always here. Not a bot product — just someone to talk to.'
)
where id = public.pingo_ai_user_id();

create or replace function public.get_ai_public_identity()
returns table (
  id uuid,
  username text,
  display_name text,
  avatar_url text,
  bio text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.username,
    p.display_name,
    p.avatar_url,
    p.bio
  from public.profiles p
  where p.id = public.pingo_ai_user_id();
$$;

revoke all on function public.get_ai_public_identity() from public;
grant execute on function public.get_ai_public_identity() to authenticated;

create or replace function public.update_ai_public_identity(
  new_display_name text default null,
  new_bio text default null,
  new_avatar_url text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  bot uuid := public.pingo_ai_user_id();
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;

  if not public.is_ai_owner() then
    raise exception 'Only the owner can update the shared AI face.';
  end if;

  update public.profiles
  set
    display_name = case
      when new_display_name is null then display_name
      else left(trim(new_display_name), 40)
    end,
    bio = case
      when new_bio is null then bio
      else left(trim(new_bio), 160)
    end,
    avatar_url = case
      when new_avatar_url is null then avatar_url
      when trim(new_avatar_url) = '' then null
      else left(trim(new_avatar_url), 500)
    end,
    updated_at = now()
  where id = bot;
end;
$$;

revoke all on function public.update_ai_public_identity(text, text, text) from public;
grant execute on function public.update_ai_public_identity(text, text, text) to authenticated;
