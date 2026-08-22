/*
 * A referral now makes the two of them friends, so they can call.
 *
 * ## Why this is allowed to be automatic
 *
 * The chat that a referral opens was easy to justify: a thread is a place to
 * talk and costs nothing if nobody does. Friendship is a stronger claim - it
 * puts each of them in the other's friends list, moves a number on both
 * profiles, and opens calling. Writing that on somebody's behalf needs a better
 * reason than convenience.
 *
 * It has one. Friendship here is normally a request and an acceptance, and a
 * referral is already both: the inviter published a link that means "come and
 * talk to me", and the person who used it chose that specific link out of
 * everything else on the internet. Both halves of the handshake happened - they
 * just happened outside the app, which is the only reason it needed encoding.
 *
 * The one thing this must never become is a way to appear in a stranger's
 * friends list. It cannot: the referral it rides on is one row per account, for
 * ever, created only when somebody used your own code, and never for an account
 * that existed before the mission.
 *
 * ## Written accepted in both directions, deliberately
 *
 * `accept_friend_request` is the closest existing path and it cannot be reused
 * here - it requires an incoming request to accept, and there is none. So both
 * rows are written directly, which is what that function does anyway once it
 * has found its request. `are_friends` and `is_mutual` both read exactly this
 * shape, so calling, the friends list and every existing gate light up without
 * knowing where the rows came from.
 *
 * `on conflict do update` rather than `do nothing`: a pending request that
 * already existed in either direction becomes accepted rather than being left
 * half-open, which is the same outcome as the person tapping Accept.
 *
 * ## Still allowed to fail
 *
 * Same rule as the conversation. What somebody earned is the referral; the
 * friendship is a convenience on top of it, and a failure here must not cost
 * them a friend they genuinely brought.
 */

create or replace function public.befriend_through_referral(a uuid, b uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if a is null or b is null or a = b then
    return;
  end if;

  insert into public.follows (follower_id, followee_id, status, created_at, responded_at)
  values (a, b, 'accepted', now(), now()), (b, a, 'accepted', now(), now())
  on conflict (follower_id, followee_id) do update
    set status = 'accepted',
        responded_at = coalesce(public.follows.responded_at, excluded.responded_at);
end;
$$;

revoke all on function public.befriend_through_referral(uuid, uuid) from public, anon, authenticated;

create or replace function public.redeem_referral(code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  m public.missions%rowtype;
  inviter uuid;
  cleaned text := upper(regexp_replace(coalesce(code, ''), '[^A-Za-z0-9]', '', 'g'));
  opened uuid;
  friends boolean := false;
begin
  if me is null then
    return jsonb_build_object('ok', false, 'reason', 'not_signed_in');
  end if;

  if not exists (select 1 from public.profiles where id = me) then
    return jsonb_build_object('ok', false, 'reason', 'no_account');
  end if;

  select * into m from public.missions where kind = 'referral' and enabled order by created_at limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_mission');
  end if;

  if not exists (select 1 from public.profiles where id = me and created_at >= m.counts_from) then
    return jsonb_build_object('ok', false, 'reason', 'account_predates_mission');
  end if;

  select id into inviter from public.profiles where referral_code = cleaned;
  if inviter is null then
    return jsonb_build_object('ok', false, 'reason', 'unknown_code');
  end if;

  if inviter = me then
    return jsonb_build_object('ok', false, 'reason', 'self_referral');
  end if;

  insert into public.referrals (referred_id, referrer_id, mission_id)
  values (me, inviter, m.id)
  on conflict (referred_id) do nothing;

  -- Whoever actually owns this referral - which may be an earlier inviter.
  select referrer_id into inviter from public.referrals where referred_id = me;

  perform public.evaluate_referral_mission(inviter, m.id);

  -- Both of these are conveniences on top of the referral, and neither is
  -- allowed to cost somebody the referral itself.
  begin
    perform public.befriend_through_referral(me, inviter);
    friends := public.are_friends(me, inviter);
  exception when others then
    friends := false;
  end;

  begin
    opened := public.start_direct_conversation(inviter);
  exception when others then
    opened := null;
  end;

  return jsonb_build_object(
    'ok', true,
    'reason', 'recorded',
    'conversationId', opened,
    'friends', friends
  );
end;
$$;

revoke all on function public.redeem_referral(text) from public, anon;
grant execute on function public.redeem_referral(text) to authenticated;
