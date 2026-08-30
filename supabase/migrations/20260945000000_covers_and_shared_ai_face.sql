-- Covers for everybody, and an AI face that is actually shared.
--
-- Two problems that turn out to be one column.
--
-- The AI's picture was already meant to be global: `update_ai_public_identity`
-- writes it to the bot's own profile row and everyone reads from there. What
-- broke it is that onboarding copied the *current* value into every user's
-- personal `ai_profiles` row, and the personal row wins. So the copy froze the
-- face at whatever it was the day that account signed up, and no later change
-- could reach them. Nine of the ten rows holding an override share two URLs
-- between them, which is what a copy looks like and not what a preference does.
--
-- And the cover had no global path at all - `ai_profiles.banner_url` is per
-- user and there was nowhere else to put one. Giving `profiles` a cover fixes
-- that and gives every human one at the same time, which is the other half of
-- what was asked for. The bot is a profile like any other; its cover is just
-- the one the RPC is allowed to write.

-- 1. Every profile can have a cover -----------------------------------------

alter table public.profiles
  add column if not exists banner_url text;

/*
 * Where the picture sits behind the face.
 *
 * A cover is a wide crop of a photo that was almost never wide, so the useful
 * part is rarely in the middle - a portrait cropped to a band shows a chin. One
 * number, the vertical percent to centre on, is what `object-position` already
 * takes, so repositioning costs no second image and no re-upload: drag, save a
 * number. 50 is centred, which is what everything did before this column.
 */
alter table public.profiles
  add column if not exists banner_offset smallint not null default 50;

alter table public.profiles
  add constraint profiles_banner_offset_range check (banner_offset between 0 and 100);

-- 2. The shared AI face gains its cover ---------------------------------------

/*
 * Dropped, not replaced. `create or replace` cannot widen the row a function
 * returns - "cannot change return type of existing function" - and the two new
 * columns are exactly that.
 */
drop function if exists public.get_ai_public_identity();

create function public.get_ai_public_identity()
returns table (
  id uuid,
  username text,
  display_name text,
  avatar_url text,
  bio text,
  banner_url text,
  banner_offset smallint
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
    p.bio,
    p.banner_url,
    p.banner_offset
  from public.profiles p
  where p.id = public.pingo_ai_user_id();
$$;

revoke all on function public.get_ai_public_identity() from public;
grant execute on function public.get_ai_public_identity() to authenticated;

/*
 * The old three-argument version is dropped rather than left beside this one.
 * Two overloads differing only in trailing defaults is a call Postgres cannot
 * resolve, and the error arrives at the caller as ambiguity rather than as
 * anything that names the real problem.
 */
drop function if exists public.update_ai_public_identity(text, text, text);

create or replace function public.update_ai_public_identity(
  new_display_name text default null,
  new_bio text default null,
  new_avatar_url text default null,
  new_banner_url text default null,
  new_banner_offset smallint default null
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
    banner_url = case
      when new_banner_url is null then banner_url
      when trim(new_banner_url) = '' then null
      else left(trim(new_banner_url), 500)
    end,
    banner_offset = case
      when new_banner_offset is null then banner_offset
      else greatest(0, least(100, new_banner_offset))
    end,
    updated_at = now()
  where id = bot;
end;
$$;

revoke all on function public.update_ai_public_identity(text, text, text, text, smallint) from public;
grant execute on function public.update_ai_public_identity(text, text, text, text, smallint) to authenticated;

-- 3. Let go of the frozen copies ---------------------------------------------

/*
 * These columns mean "this user deliberately chose something different". They
 * never did - onboarding wrote the value for them - so clearing them is not
 * discarding a preference, it is deleting a copy that was standing in front of
 * the real answer. Anybody who does want their own picture can set one, and
 * that row will then say something true.
 *
 * Scoped to values shared by more than one account, or equal to the face the
 * bot is wearing right now. A genuinely personal upload belongs to exactly one
 * row and survives this.
 */
with shared as (
  select avatar_url
  from public.ai_profiles
  where avatar_url is not null
  group by avatar_url
  having count(*) > 1
)
update public.ai_profiles a
set avatar_url = null, updated_at = now()
where a.avatar_url is not null
  and (
    a.avatar_url in (select avatar_url from shared)
    or a.avatar_url = (select p.avatar_url from public.profiles p where p.id = public.pingo_ai_user_id())
  );

/*
 * The name, same story - and it needs the column to admit it has no answer.
 *
 * `display_name` was NOT NULL, which is what forced onboarding to put
 * *something* there, and the only something available was a copy of the global
 * name. A required override is a contradiction: the whole meaning of this
 * column is "unless the user said otherwise", and a column that cannot be empty
 * cannot say "they did not".
 */
alter table public.ai_profiles
  alter column display_name drop not null;

update public.ai_profiles a
set display_name = null, updated_at = now()
where a.display_name is not null
  and a.display_name = (select p.display_name from public.profiles p where p.id = public.pingo_ai_user_id());

/*
 * And the twelve rows that still said "PINGO" while the shared name had moved
 * on to "PINGO AI". Not a name twelve people picked - it is onboarding's own
 * hardcoded fallback, `pub?.displayName ?? 'PINGO'`, written once per account.
 * Same test as the avatars: a value held by more than one row is a copy.
 */
with shared_name as (
  select display_name from public.ai_profiles where display_name is not null
  group by display_name having count(*) > 1
)
update public.ai_profiles a
set display_name = null, updated_at = now()
where a.display_name in (select display_name from shared_name);
