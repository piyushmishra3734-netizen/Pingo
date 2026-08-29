-- FOUNDER, and the difference between owning a badge and wearing one.
--
-- ## Two accounts, named by id
--
-- FOUNDER belongs to the two people who started PINGO and to nobody else. They
-- are written here as user ids rather than usernames because a username is
-- something its owner can change, and a grant that follows the name would
-- follow it to whoever claims it next.
--
-- There is no rule to evaluate and no mission to complete, so there is nothing
-- for a client to ask for: the rows are inserted by this migration and the only
-- way to gain another is another migration. That is the whole of the security
-- model, and it is stronger than any check that runs at request time.
--
-- ## Earned is not displayed
--
-- Until now "which badge shows beside your name" was decided by
-- `leadAchievement`: the rare tier first, then registry order. With one badge
-- that was the same question. With two it is not, and the answer belongs to the
-- person wearing it.
--
-- So `displayed` is a column on the badge somebody already owns, not a
-- separate table and not a preference. That shape is what makes the invariant
-- free: you cannot display a badge you have not earned, because the row would
-- not exist. Deselecting is not revoking - the row stays, `displayed` goes back
-- to false, and the collection is unchanged.
--
-- The partial unique index is the other half: at most one displayed badge per
-- account, enforced where it cannot be got wrong rather than in the function
-- that sets it.
--
-- `false` for everybody means nothing changes for accounts that never choose -
-- `leadAchievement` falls back to exactly the order it used before.

-- ---------------------------------------------------------------------------
-- 1. The badge
-- ---------------------------------------------------------------------------

insert into public.user_badges (user_id, badge_id, mission_id)
values
  ('f32129ea-9ecd-4e56-a67c-d9837e9e2cc2', 'founder', null),  -- piuxxh
  ('7e9b3e44-52b0-41a1-b514-7a25f46ac72b', 'founder', null)   -- kashish_
on conflict (user_id, badge_id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Which one is worn
-- ---------------------------------------------------------------------------

alter table public.user_badges
  add column if not exists displayed boolean not null default false;

comment on column public.user_badges.displayed is
  'The badge this account wears beside its name. At most one; false for everybody means fall back to the registry order.';

/*
 * One at a time.
 *
 * A partial unique index rather than a check in the setter: two calls racing
 * would each see no displayed row and each set one, and only the database can
 * settle that. It also means the "at most one" rule survives anything that
 * writes this table in future without knowing about it.
 */
create unique index if not exists user_badges_one_displayed
  on public.user_badges (user_id)
  where displayed;

/*
 * FOUNDER starts as the one on show, because it is the rarer of the two badges
 * these accounts hold and `leadAchievement` would otherwise pick MYTHIC
 * PIONEER by tier. Written as a choice rather than as a rule in the code, so
 * changing it is the same operation as changing any other.
 *
 * Guarded so it is idempotent and can never overwrite a choice already made -
 * re-running this migration after somebody switches to MYTHIC leaves them on
 * MYTHIC.
 */
update public.user_badges u
   set displayed = true
 where u.badge_id = 'founder'
   and not exists (
     select 1 from public.user_badges d
      where d.user_id = u.user_id and d.displayed
   );

-- ---------------------------------------------------------------------------
-- 3. Choosing
-- ---------------------------------------------------------------------------

/*
 * The only way `displayed` moves.
 *
 * `user_badges` has no insert or update policy - every write goes through a
 * `security definer` function - so this is the whole surface, and it can only
 * ever touch the caller's own rows. Passing null clears the choice and returns
 * the account to the default order.
 *
 * The clear runs before the set so the unique index is never briefly violated
 * inside the statement.
 */
create or replace function public.set_displayed_badge(p_badge_id text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  update public.user_badges
     set displayed = false
   where user_id = me and displayed;

  if p_badge_id is null then
    return null;
  end if;

  update public.user_badges
     set displayed = true
   where user_id = me and badge_id = p_badge_id;

  if not found then
    -- Not "no such badge": the badge may well exist, it is simply not theirs.
    raise exception 'that badge is not earned by this account'
      using errcode = '42501';
  end if;

  return p_badge_id;
end;
$$;

revoke all on function public.set_displayed_badge(text) from public, anon;
grant execute on function public.set_displayed_badge(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The privileges this table should have had all along
-- ---------------------------------------------------------------------------

/*
 * Measured while adding the column: `anon` and `authenticated` both held
 * INSERT, UPDATE, DELETE and TRUNCATE here, from Supabase's default privileges
 * for a new table in `public`. Row-level security covers the first three - the
 * table has a select policy and nothing else, so those writes are refused.
 *
 * TRUNCATE is not a row-level operation and no policy touches it. Nothing
 * reachable issues one today, because PostgREST speaks only SELECT, INSERT,
 * UPDATE, DELETE and RPC - but "no caller happens to ask for it" is not the
 * same as "it is not permitted", and what it would delete is every badge on the
 * product.
 *
 * Same trap as `backup_anchor` in 20260937000000, and the same fix: take the
 * grants away and hand back only the one that is wanted. Reads stay open to
 * both roles because the badge beside a name is public by design.
 */
revoke all on table public.user_badges from anon, authenticated;
grant select on table public.user_badges to anon, authenticated;
