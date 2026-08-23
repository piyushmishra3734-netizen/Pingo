-- The mission had a number where it should have had people.
--
-- `referral_progress` returned a count, so the screen could say "2 of 5" and
-- nothing else. That reads as a placeholder, because it is one: the whole point
-- of the mission is that real friends joined, and the screen was the only place
-- that never said who.
--
-- ## Why this goes in the same function rather than beside it
--
-- The count and the list are the same fact asked twice. A separate query for
-- the roster would be a second definition of "who counts" - the mission filter,
-- the `counts_from` cutoff, the join to `profiles` - and the first time one of
-- them changed, the screen would show four faces above the number five. The
-- original function's own header says exactly this about the count and the
-- badge; the roster belongs under the same rule.
--
-- It also stays one round trip, which is what the function was built to be.
--
-- ## What is returned, and what is not
--
-- Enough to draw a person: id, username, display name, avatar, when they
-- joined. Not their email, not their activity, nothing the profile screen would
-- not already show to somebody who tapped through. Capped at 24, because the
-- link keeps working long after the mission is finished and a roster is a row
-- of faces, not a directory - the count remains the authority on how many.

create or replace function public.referral_progress()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  me uuid := auth.uid();
  m public.missions%rowtype;
  earned integer := 0;
  code text;
  roster jsonb;
begin
  if me is null then
    return jsonb_build_object('ok', false, 'reason', 'not_signed_in');
  end if;

  select referral_code into code from public.profiles where id = me;
  select * into m from public.missions where kind = 'referral' and enabled order by created_at limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_mission');
  end if;

  select count(*) into earned
    from public.referrals r
    join public.profiles p on p.id = r.referred_id
   where r.referrer_id = me
     and r.mission_id = m.id
     and p.created_at >= m.counts_from;

  /*
   * Oldest first, so the nth face lines up with the nth filled segment on the
   * progress bar. A newest-first list would reshuffle every time somebody
   * joined, which is the wrong behaviour for a row that is meant to read as a
   * record of what happened.
   */
  select coalesce(jsonb_agg(f order by f_joined), '[]'::jsonb) into roster
    from (
      select jsonb_build_object(
               'id', p.id,
               'username', p.username,
               'displayName', p.display_name,
               'avatarUrl', p.avatar_url,
               'joinedAt', p.created_at
             ) as f,
             p.created_at as f_joined
        from public.referrals r
        join public.profiles p on p.id = r.referred_id
       where r.referrer_id = me
         and r.mission_id = m.id
         and p.created_at >= m.counts_from
       order by p.created_at
       limit 24
    ) picked;

  return jsonb_build_object(
    'ok', true,
    'missionId', m.id,
    'title', m.title,
    'description', m.description,
    'badgeId', m.badge_id,
    'referralCode', code,
    'count', earned,
    'required', m.required_count,
    'friends', roster,
    'unlocked', exists (
      select 1 from public.user_badges
       where user_id = me and badge_id = m.badge_id
    )
  );
end;
$$;

revoke all on function public.referral_progress() from public, anon;
grant execute on function public.referral_progress() to authenticated;
