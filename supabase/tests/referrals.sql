/*
 * The referral rules, asserted against the real database.
 *
 * Every rule this file checks is one an attacker would otherwise try: counting
 * yourself, counting the same person twice, changing who invited you after the
 * fact, or farming accounts that were already here. They are enforced by
 * constraints and by `redeem_referral`, and this is the proof that they are.
 *
 * Runs entirely inside a transaction that rolls back, so it is safe against
 * production and leaves nothing behind - including the throwaway accounts it
 * needs, which have to be real rows because every rule here is a foreign key or
 * a policy that would not fire against a mock.
 *
 * Run:  psql "$DATABASE_URL" -f supabase/tests/referrals.sql
 *   or paste into the SQL editor. An assertion failure raises; silence is a
 *   pass.
 */

begin;

-- ---------------------------------------------------------------------------
-- Throwaway accounts
-- ---------------------------------------------------------------------------

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
select ('00000000-0000-4000-8000-0000000000' || lpad(g::text, 2, '0'))::uuid,
       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'referral-test-' || g || '@example.test', 'x', now(), now()
from generate_series(10, 40) g;

insert into public.profiles (id, username, display_name)
select ('00000000-0000-4000-8000-0000000000' || lpad(g::text, 2, '0'))::uuid,
       'reftest' || g, 'Referral Test ' || g
from generate_series(10, 40) g;

-- ---------------------------------------------------------------------------
-- 1. Identity: every account gets its own link
-- ---------------------------------------------------------------------------

do $$
declare
  issued integer;
  distinct_codes integer;
begin
  select count(referral_code), count(distinct referral_code) into issued, distinct_codes
    from public.profiles;
  assert issued = (select count(*) from public.profiles), 'every profile must have a referral code';
  assert distinct_codes = issued, 'referral codes must be unique';
  raise notice 'identity ok';
end $$;

-- ---------------------------------------------------------------------------
-- 2. Attribution and abuse
-- ---------------------------------------------------------------------------

do $$
declare
  inviter uuid := '00000000-0000-4000-8000-000000000010';
  joiner uuid := '00000000-0000-4000-8000-000000000011';
  code text;
  rival_code text;
  res jsonb;
  n integer;
begin
  select referral_code into code from public.profiles where id = inviter;
  select referral_code into rival_code from public.profiles where id = '00000000-0000-4000-8000-000000000020';

  perform set_config('request.jwt.claims', json_build_object('sub', inviter)::text, true);
  res := public.redeem_referral(code);
  assert res->>'reason' = 'self_referral', 'inviting yourself must be refused: ' || res::text;

  res := public.redeem_referral('ZZZZZZZZ');
  assert res->>'reason' = 'unknown_code', 'an unknown code must be refused: ' || res::text;

  perform set_config('request.jwt.claims', json_build_object('sub', joiner)::text, true);
  res := public.redeem_referral(code);
  assert res->>'ok' = 'true', 'a real referral must record: ' || res::text;

  -- Logging out and back in, reopening the link, refreshing: all of these are
  -- the same call again.
  res := public.redeem_referral(code);
  res := public.redeem_referral(code);
  select count(*) into n from public.referrals where referrer_id = inviter;
  assert n = 1, 'a joiner must count once, got ' || n;

  -- Opening somebody else's link afterwards must not move the attribution.
  res := public.redeem_referral(rival_code);
  select count(*) into n
    from public.referrals where referred_id = joiner and referrer_id = inviter;
  assert n = 1, 'the original inviter must be immutable';

  raise notice 'attribution ok';
end $$;

-- ---------------------------------------------------------------------------
-- 3. An account that was already here cannot be farmed
-- ---------------------------------------------------------------------------

do $$
declare
  old_user uuid;
  code text;
  res jsonb;
begin
  select id into old_user
    from public.profiles
   where created_at < (select counts_from from public.missions where id = 'mythic_pioneer')
   limit 1;

  if old_user is null then
    raise notice 'historical guard skipped - no account predates the mission';
    return;
  end if;

  select referral_code into code from public.profiles where id <> old_user limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', old_user)::text, true);
  res := public.redeem_referral(code);
  assert res->>'reason' = 'account_predates_mission',
    'an account older than the mission must not count: ' || res::text;

  raise notice 'historical guard ok';
end $$;

-- ---------------------------------------------------------------------------
-- 4. The mission, from nothing to unlocked
-- ---------------------------------------------------------------------------

do $$
declare
  inviter uuid := '00000000-0000-4000-8000-000000000030';
  code text;
  res jsonb;
  progress jsonb;
  g integer;
  badges integer;
  needed integer;
begin
  select referral_code into code from public.profiles where id = inviter;
  select required_count into needed from public.missions where id = 'mythic_pioneer';

  perform set_config('request.jwt.claims', json_build_object('sub', inviter)::text, true);
  progress := public.referral_progress();
  assert (progress->>'count')::int = 0, 'a new inviter starts at zero';
  assert (progress->>'unlocked')::boolean = false, 'and starts locked';

  -- One short of the requirement.
  for g in 31 .. (30 + needed - 1) loop
    perform set_config('request.jwt.claims',
      json_build_object('sub', ('00000000-0000-4000-8000-0000000000' || g)::uuid)::text, true);
    res := public.redeem_referral(code);
    assert res->>'ok' = 'true', 'joiner ' || g || ' should record: ' || res::text;
  end loop;

  perform set_config('request.jwt.claims', json_build_object('sub', inviter)::text, true);
  progress := public.referral_progress();
  assert (progress->>'count')::int = needed - 1, 'one short expected';
  assert (progress->>'unlocked')::boolean = false, 'one short must still be locked';

  -- The one that completes it.
  perform set_config('request.jwt.claims',
    json_build_object('sub', ('00000000-0000-4000-8000-0000000000' || (30 + needed))::uuid)::text, true);
  res := public.redeem_referral(code);

  perform set_config('request.jwt.claims', json_build_object('sub', inviter)::text, true);
  progress := public.referral_progress();
  assert (progress->>'count')::int = needed, 'the requirement should be met';
  assert (progress->>'unlocked')::boolean = true, 'the badge must unlock';

  -- One more joiner, and the completion processed twice, both change nothing.
  perform set_config('request.jwt.claims',
    json_build_object('sub', ('00000000-0000-4000-8000-0000000000' || (31 + needed))::uuid)::text, true);
  res := public.redeem_referral(code);
  perform public.evaluate_referral_mission(inviter, 'mythic_pioneer');
  perform public.evaluate_referral_mission(inviter, 'mythic_pioneer');

  select count(*) into badges from public.user_badges where user_id = inviter;
  assert badges = 1, 'the badge must exist exactly once, got ' || badges;

  raise notice 'mission ok';
end $$;

rollback;
