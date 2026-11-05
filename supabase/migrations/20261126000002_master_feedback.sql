-- PINGO Feedback: tell PINGO AI what you wish for, approve it, and it lands in
-- the operator's "PINGO Feedback" chat under your name.
--
-- A fifth kind of Master task, `send_feedback`. It works like every other one:
-- PINGO AI only PROPOSES it (an Approve card in the chat), the person approves
-- it with their own session, and only then does the database send it. What is
-- different:
--
--   * It costs nothing. Feedback is the one thing we want more of, so it takes
--     no credits (`credits = 0`), and approving it does not touch the day's
--     credit count.
--   * It does not need a chat to send into. It goes to one place, the
--     operator's PINGO Feedback chat, which is made on the first one.
--
-- What the operator sees there is a normal chat with a profile called
-- "PINGO Feedback", and each message reads "Name (@username) - Wish" followed
-- by the person's words. The name is the person's own, and the approval card
-- says so before they tap.
--
-- The Settings > Wishes & feedback form (20261125000000_feedback.sql) now ends
-- up in the same chat, so there is one inbox with one notification, not two.
--
-- Both paths also write the `feedback` table, which is what the person sees as
-- "what you have sent" with its status, and what Controlling's inbox reads.

-- ---------------------------------------------------------------------------
-- Where it came from
-- ---------------------------------------------------------------------------

alter table public.feedback
  add column if not exists source text not null default 'form'
  check (source in ('form', 'master'));

-- ---------------------------------------------------------------------------
-- The "PINGO Feedback" identity: a profile for the chat to be with, not a login.
-- ---------------------------------------------------------------------------

create or replace function public.pingo_feedback_user_id()
returns uuid
language sql
immutable
as $$
  select 'a1000000-0000-4000-8000-0000000000f1'::uuid;
$$;

create extension if not exists pgcrypto with schema extensions;

do $$
declare
  bot uuid := public.pingo_feedback_user_id();
begin
  if not exists (select 1 from auth.users where id = bot) then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous
    ) values (
      '00000000-0000-0000-0000-000000000000', bot, 'authenticated', 'authenticated',
      'pingo-feedback@system.local',
      extensions.crypt('pingo-feedback-no-login', extensions.gen_salt('bf')),
      now(),
      '{"provider":"system","providers":["system"]}'::jsonb,
      '{"display_name":"PINGO Feedback"}'::jsonb,
      now(), now(), false, false
    );
  end if;

  insert into public.profiles (id, username, display_name, bio)
  values (bot, 'pingo_feedback', 'PINGO Feedback', null)
  on conflict (id) do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- One delivery, used by both paths: record it, and put it in the operator's chat.
-- ---------------------------------------------------------------------------

create or replace function public.feedback_deliver(p_user uuid, p_kind text, p_body text, p_source text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  op constant uuid := 'f32129ea-9ecd-4e56-a67c-d9837e9e2cc2';
  bot uuid := public.pingo_feedback_user_id();
  fb uuid;
  conv uuid;
  nm text;
  un text;
  label text;
begin
  insert into public.feedback (user_id, kind, body, source)
  values (p_user, p_kind, p_body, p_source)
  returning id into fb;

  -- The operator's chat with "PINGO Feedback": found, or made the first time.
  select c.id into conv
  from public.conversations c
  join public.conversation_members a on a.conversation_id = c.id and a.user_id = op
  join public.conversation_members b on b.conversation_id = c.id and b.user_id = bot
  where c.kind = 'direct'
  limit 1;

  if conv is null then
    insert into public.conversations (kind, created_by) values ('direct', bot) returning id into conv;
    insert into public.conversation_members (conversation_id, user_id, pinned)
    values (conv, op, true), (conv, bot, false);
  end if;

  select p.display_name, p.username into nm, un from public.profiles p where p.id = p_user;
  label := case p_kind
    when 'wish' then 'Wish'
    when 'fix' then 'Something to fix'
    when 'love' then 'Love'
    else 'Feedback'
  end;

  insert into public.messages (conversation_id, sender_id, body, meta)
  values (
    conv,
    bot,
    left(coalesce(nm, 'Someone') || ' (@' || coalesce(un, 'unknown') || ') - ' || label || E'\n\n' || p_body, 4000),
    jsonb_build_object('feedbackId', fb, 'fromUser', p_user)
  );
  update public.conversations set last_message_at = now() where id = conv;

  return fb;
end;
$$;
revoke all on function public.feedback_deliver(uuid, text, text, text) from public, anon, authenticated;

-- The Settings form: same checks as before, but it now goes through the one delivery.
create or replace function public.feedback_send(
  p_kind text,
  p_body text,
  p_app_version text default null,
  p_platform text default null
)
returns public.feedback
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  clean text := btrim(coalesce(p_body, ''));
  fb uuid;
  row public.feedback;
begin
  if me is null then
    raise exception 'Sign in to send feedback.';
  end if;
  if p_kind not in ('wish', 'fix', 'love', 'other') then
    raise exception 'Pick what kind of message this is.';
  end if;
  if char_length(clean) < 3 then
    raise exception 'Write a little more, then send.';
  end if;
  if char_length(clean) > 2000 then
    raise exception 'That is over 2000 characters. Please shorten it.';
  end if;
  if (select count(*) from public.feedback f
       where f.user_id = me and f.created_at > now() - interval '1 day') >= 5 then
    raise exception 'You have sent a few today already. Try again tomorrow.';
  end if;
  if exists (select 1 from public.feedback f
              where f.user_id = me and f.body = clean and f.created_at > now() - interval '1 day') then
    raise exception 'You already sent this one.';
  end if;

  fb := public.feedback_deliver(me, p_kind, clean, 'form');

  -- What it was sent from, for the inbox. Not part of the chat message.
  update public.feedback
  set app_version = left(p_app_version, 40),
      platform = case when p_platform in ('android', 'web') then p_platform else null end
  where id = fb;

  select * into row from public.feedback where id = fb;
  return row;
end;
$$;

-- ---------------------------------------------------------------------------
-- The Master task
-- ---------------------------------------------------------------------------

alter table public.ai_actions drop constraint if exists ai_actions_kind_check;
alter table public.ai_actions
  add constraint ai_actions_kind_check
  check (kind in ('send_message', 'set_setting', 'mute_chat', 'create_playlist', 'send_feedback'));

-- Checking: the existing checks stay as they are, under a new name; this one
-- only adds its own kind and hands everything else on.
do $$
begin
  if to_regprocedure('public.master_check_prev(uuid, text, jsonb, uuid)') is null then
    alter function public.master_check(uuid, text, jsonb, uuid) rename to master_check_prev;
  end if;
end $$;
revoke all on function public.master_check_prev(uuid, text, jsonb, uuid) from public, anon, authenticated;

create or replace function public.master_check(p_user uuid, p_kind text, p_params jsonb, p_self uuid default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  s record;
  said text;
  k text;
begin
  if p_kind <> 'send_feedback' then
    return public.master_check_prev(p_user, p_kind, p_params, p_self);
  end if;

  select * into s from public.ai_master_settings where user_id = p_user;
  if s is null or not s.enabled then return 'PINGO Master is switched off.'; end if;

  said := btrim(coalesce(p_params->>'text', ''));
  k := coalesce(nullif(p_params->>'kind', ''), 'wish');
  if k not in ('wish', 'fix', 'love', 'other') then return 'Pick what kind of feedback this is.'; end if;
  if char_length(said) < 3 or char_length(said) > 2000 then
    return 'The feedback must be between 3 and 2000 characters.';
  end if;
  if (select count(*) from public.feedback f
       where f.user_id = p_user and f.created_at > now() - interval '1 day') >= 5 then
    return 'You have sent a few today already. Try again tomorrow.';
  end if;
  if exists (select 1 from public.feedback f
              where f.user_id = p_user and f.body = said and f.created_at > now() - interval '1 day') then
    return 'You already sent this one.';
  end if;
  return null;
end;
$$;
revoke all on function public.master_check(uuid, text, jsonb, uuid) from public, anon, authenticated;

-- Proposing: the same, with the new kind allowed, and no credits for it.
create or replace function public.master_propose(p_kind text, p_params jsonb, p_run_at timestamptz default null)
returns public.ai_actions language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  problem text;
  made integer;
  row public.ai_actions;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if p_kind not in ('send_message', 'set_setting', 'mute_chat', 'create_playlist', 'send_feedback') then
    raise exception 'Unknown task.';
  end if;

  select count(*) into made from public.ai_actions
  where user_id = me and created_at > now() - interval '1 day';
  if made >= public.master_day_cap() then raise exception 'That is plenty for one day. Try again tomorrow.'; end if;

  problem := public.master_check(me, p_kind, p_params);
  if problem is not null then raise exception '%', problem; end if;

  if p_run_at is not null and (p_run_at > now() + interval '30 days') then
    raise exception 'That is too far ahead. 30 days at most.';
  end if;

  insert into public.ai_actions (user_id, kind, params, params_hash, run_at, credits)
  values (
    me, p_kind, p_params,
    md5(p_kind || coalesce(p_run_at::text, '') || p_params::text),
    case when p_run_at is not null and p_run_at > now() then p_run_at end,
    case when p_kind = 'send_feedback' then 0 else 5 end
  )
  returning * into row;
  return row;
end;
$$;

-- Approving: the same, but a task that costs nothing takes nothing and has
-- nothing to give back if it is cancelled.
create or replace function public.master_approve(p_id uuid)
returns public.ai_actions language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  a public.ai_actions;
  problem text;
  left_ integer;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  select * into a from public.ai_actions where id = p_id and user_id = me for update;
  if a is null then raise exception 'That task is gone.'; end if;
  if a.status <> 'pending' then raise exception 'That task was already decided.'; end if;
  if a.expires_at < now() then
    update public.ai_actions set status = 'expired', decided_at = now() where id = a.id;
    raise exception 'That task expired. Ask again.';
  end if;

  problem := public.master_check(me, a.kind, a.params, a.id);
  if problem is not null then raise exception '%', problem; end if;

  if a.credits > 0 then
    left_ := public.ai_spend_credits(me, a.credits);
    if left_ < 0 then raise exception 'Not enough credits left today.'; end if;
  end if;

  update public.ai_actions
  set status = 'scheduled', credits_taken = (a.credits > 0), decided_at = now()
  where id = a.id;

  -- Now, or later: a task due within the minute runs straight away.
  if a.run_at is null or a.run_at <= now() + interval '1 minute' then
    perform public.master_run(a.id);
  end if;

  select * into a from public.ai_actions where id = a.id;
  return a;
end;
$$;

-- Running: the existing run, under a new name, for every other kind.
do $$
begin
  if to_regprocedure('public.master_run_prev(uuid)') is null then
    alter function public.master_run(uuid) rename to master_run_prev;
  end if;
end $$;
revoke all on function public.master_run_prev(uuid) from public, anon, authenticated;

create or replace function public.master_run(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  a public.ai_actions;
  problem text;
begin
  select * into a from public.ai_actions where id = p_id;
  if a is null or a.kind <> 'send_feedback' then
    perform public.master_run_prev(p_id);
    return;
  end if;

  select * into a from public.ai_actions where id = p_id for update;
  if a.status not in ('scheduled', 'pending') then return; end if;

  -- What was approved is exactly what runs.
  if a.params_hash <> md5(a.kind || coalesce(a.run_at::text, '') || a.params::text) then
    update public.ai_actions set status = 'failed', done_at = now(), result = 'Changed after approval' where id = a.id;
    return;
  end if;

  problem := public.master_check(a.user_id, a.kind, a.params, a.id);
  if problem is not null then
    update public.ai_actions set status = 'failed', done_at = now(), result = problem where id = a.id;
    return;
  end if;

  perform public.feedback_deliver(
    a.user_id,
    coalesce(nullif(a.params->>'kind', ''), 'wish'),
    btrim(a.params->>'text'),
    'master'
  );

  update public.ai_actions set status = 'done', done_at = now(), result = 'Sent' where id = a.id;
exception when others then
  update public.ai_actions set status = 'failed', done_at = now(), result = 'Could not be sent'
  where id = p_id and status in ('scheduled', 'pending');
end;
$$;
revoke all on function public.master_run(uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';
