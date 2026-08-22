/*
 * A referral does two things now: it counts, and it opens the chat.
 *
 * ## The gap this closes
 *
 * Somebody taps a friend's link, signs up, and lands in an empty app. The
 * person who invited them is the one account they certainly want - and until
 * now they had to go and find them by username, which is the one thing a new
 * user does not know. The invitation brought them here and then abandoned them
 * at the door.
 *
 * So the referral that credits the inviter also puts the two of them in a
 * conversation. One tap, two outcomes: the inviter's badge moves, and their
 * name is already in the new person's chat list when the app opens.
 *
 * ## A conversation, deliberately, and not a friendship
 *
 * It would be easy to make them follow each other here and it is the wrong
 * call. A follow is a claim about a relationship, made on somebody's behalf,
 * and it feeds counts and lists that are theirs to decide. A conversation is
 * only a place to talk, which is exactly what the link was an offer of - and if
 * they never use it, an empty thread costs nothing and says nothing about
 * either of them.
 *
 * ## Reusing `start_direct_conversation` rather than writing rows
 *
 * It already refuses self-chats, already refuses unknown users, and already
 * returns the existing thread when there is one instead of making a second.
 * That last property is what makes this safe to run again: `redeem_referral`
 * is called on every launch until it succeeds, and a fresh conversation per
 * launch would be the obvious way to turn a good idea into a duplicate mess.
 *
 * It reads `auth.uid()`, which inside a `security definer` function is still
 * the caller - the person who just joined. So the thread is created by them,
 * which is also the honest record of what happened.
 *
 * ## Why a failure here cannot fail the referral
 *
 * The count is the thing somebody earned; the chat is a convenience on top of
 * it. If the conversation cannot be made, the referral still stands and the
 * badge still progresses - the alternative is a person who invited a friend
 * successfully and got nothing for it because of a row in another table.
 */

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

  /*
   * The chat, and it is allowed to fail.
   *
   * Attributed to the inviter who actually owns the referral rather than to
   * whichever code was just handed over: somebody who opens a second link
   * after already being attributed gets no new thread out of it, for the same
   * reason they get no second inviter.
   */
  begin
    opened := public.start_direct_conversation(inviter);
  exception when others then
    opened := null;
  end;

  return jsonb_build_object(
    'ok', true,
    'reason', 'recorded',
    'conversationId', opened
  );
end;
$$;

revoke all on function public.redeem_referral(text) from public, anon;
grant execute on function public.redeem_referral(text) to authenticated;
