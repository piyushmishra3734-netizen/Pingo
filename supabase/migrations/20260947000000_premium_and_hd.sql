-- Premium, as one boolean and nothing else yet.
--
-- What premium *unlocks* is decided in the app (today: sending media at its
-- original quality instead of 480p). How somebody *gets* it is not decided at
-- all - there is no payment, no trial, no expiry. Granting is a manual operator
-- action, which is the honest shape of "billing comes later": the gate is real
-- and testable now, and the door it opens can be built without touching
-- anything that reads this column.

alter table public.profiles
  add column if not exists is_premium boolean not null default false;

/*
 * Written by the operator only, and never by the account itself.
 *
 * A SECURITY DEFINER function with the owner check is the only place this write
 * can live - see the column grant below for why the obvious alternative does
 * not work.
 */
create or replace function public.set_premium(target uuid, value boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_ai_owner() then
    raise exception 'Only the operator can grant premium.';
  end if;
  update public.profiles set is_premium = value, updated_at = now() where id = target;
end;
$$;

revoke all on function public.set_premium(uuid, boolean) from public, anon;
grant execute on function public.set_premium(uuid, boolean) to authenticated;

/*
 * The column a user must not be able to set on themselves.
 *
 * RLS is row-level. The "update your own profile" policy that lets somebody
 * change their name also lets them change every other column of that row, and
 * `is_premium` had just become one of them - so the paywall would have been one
 * PATCH request wide. Column privileges are the only thing in Postgres that
 * draws this line, and they are checked before RLS ever runs.
 *
 * Re-granted explicitly rather than revoked in place: `revoke update (col)`
 * after a table-wide `grant update` leaves the table-wide grant standing.
 */
revoke update on public.profiles from anon, authenticated;

grant update (
  username, display_name, avatar_url, bio, banner_url, banner_offset, updated_at,
  friends_display_seed, groups_display_seed, referral_code
) on public.profiles to authenticated;
