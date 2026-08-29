-- When it was earned, which is most of what makes it feel earned.
--
-- The completed mission screen said "Unlocked" and nothing else, and a badge
-- with no date on it reads like a flag in a database rather than something that
-- happened to somebody. `user_badges.unlocked_at` has been recorded since the
-- badge existed; it simply was not being handed to the client.
--
-- Same function rather than a second query, for the reason the roster went in
-- here too: `unlocked` and `unlockedAt` are one fact, and a screen that read
-- them from two places would eventually show a date beside "not yet earned".

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
  earned_at timestamptz;
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

  select unlocked_at into earned_at
    from public.user_badges
   where user_id = me and badge_id = m.badge_id;

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
    'unlocked', earned_at is not null,
    'unlockedAt', earned_at
  );
end;
$$;

revoke all on function public.referral_progress() from public, anon;
grant execute on function public.referral_progress() to authenticated;
