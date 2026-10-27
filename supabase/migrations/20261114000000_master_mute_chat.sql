-- PINGO Master: mute or unmute ONE chat, for a while, and a log of what people
-- ask for that PINGO AI cannot do yet.
--
-- mute_chat is a third kind of task beside send_message and set_setting. It is
-- applied here, by the database, on approval (not by the app), and it only ever
-- touches the person's own conversation_members row for a chat they are in.
--
--   mode 'mute'    muted for `minutes` (or for good when minutes is 0)
--   mode 'unmute'  unmuted; with `minutes` it comes back to what it was after
--                  that long ("unmute for 2 hours"), unless the person changed
--                  the mute themselves in the meantime
--
-- ai_wishes is the other half of "smart": when a person asks for something with
-- no tool, PINGO AI says so and writes the ask down here, so what people want
-- is ranked by real demand and the next tool is a small, reviewed addition.
-- It stores the person's own words about their own request, nothing from chats.

alter table public.ai_actions drop constraint if exists ai_actions_kind_check;
alter table public.ai_actions
  add constraint ai_actions_kind_check check (kind in ('send_message', 'set_setting', 'mute_chat'));

-- What to put back, and when. Not part of params_hash: it is written by the run.
alter table public.ai_actions add column if not exists undo jsonb;
alter table public.ai_actions add column if not exists undo_at timestamptz;
create index if not exists ai_actions_undo_due on public.ai_actions (undo_at) where undo is not null;

-- ---------------------------------------------------------------------------
-- Checking: the existing master_check, plus mute_chat.
-- ---------------------------------------------------------------------------

create or replace function public.master_check(p_user uuid, p_kind text, p_params jsonb, p_self uuid default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  s record;
  conv uuid;
  text_ text;
  ckind text;
  other uuid;
  sent integer;
  mins integer;
begin
  select * into s from public.ai_master_settings where user_id = p_user;
  if s is null or not s.enabled then return 'PINGO Master is switched off.'; end if;

  if p_kind = 'set_setting' then
    if not s.allow_settings then return 'Changing settings is switched off.'; end if;
    if not public.master_setting_ok(p_params->>'key', p_params->>'value') then
      return 'That setting cannot be changed by PINGO AI.';
    end if;
    return null;
  end if;

  if p_kind = 'mute_chat' then
    if not s.allow_settings then return 'Changing settings is switched off.'; end if;
    begin
      conv := (p_params->>'conversation_id')::uuid;
      mins := coalesce((p_params->>'minutes')::integer, 0);
    exception when others then
      return 'That chat was not understood.';
    end;
    if p_params->>'mode' not in ('mute', 'unmute') then return 'Mute or unmute only.'; end if;
    if mins < 0 or mins > 10080 then return 'The time must be between 1 minute and 7 days.'; end if;
    select c.kind into ckind from public.conversations c where c.id = conv;
    if ckind is null or ckind not in ('direct', 'group') then
      return 'PINGO AI can only mute your direct chats and groups.';
    end if;
    if not exists (
      select 1 from public.conversation_members m
      where m.conversation_id = conv and m.user_id = p_user and m.deleted_at is null
    ) then
      return 'You are not in that chat.';
    end if;
    return null;
  end if;

  if p_kind = 'send_message' then
    if not s.allow_messages then return 'Sending messages is switched off.'; end if;
    begin
      conv := (p_params->>'conversation_id')::uuid;
    exception when others then
      return 'That chat was not understood.';
    end;
    text_ := btrim(coalesce(p_params->>'text', ''));
    if char_length(text_) < 1 or char_length(text_) > 1500 then
      return 'The message must be between 1 and 1500 characters.';
    end if;

    select c.kind into ckind from public.conversations c where c.id = conv;
    if ckind is null or ckind not in ('direct', 'group') then
      return 'PINGO AI can only message your direct chats and groups.';
    end if;
    if not exists (
      select 1 from public.conversation_members m
      where m.conversation_id = conv and m.user_id = p_user and m.deleted_at is null
    ) then
      return 'You are not in that chat.';
    end if;

    if ckind = 'direct' then
      select m.user_id into other from public.conversation_members m
      where m.conversation_id = conv and m.user_id <> p_user limit 1;
      if other is not null and exists (
        select 1 from public.blocks b
        where (b.blocker_id = p_user and b.blocked_id = other)
           or (b.blocker_id = other and b.blocked_id = p_user)
      ) then
        return 'You cannot message this person.';
      end if;
    end if;

    select count(*) into sent from public.ai_actions
    where user_id = p_user and kind = 'send_message' and status in ('scheduled', 'done')
      and params->>'conversation_id' = conv::text
      and created_at > now() - interval '1 day'
      and id is distinct from p_self;
    if sent >= public.master_chat_cap() then
      return 'PINGO AI has already sent enough messages in this chat today.';
    end if;
    return null;
  end if;

  return 'Unknown task.';
end;
$$;
revoke all on function public.master_check(uuid, text, jsonb, uuid) from public, anon, authenticated;

create or replace function public.master_propose(p_kind text, p_params jsonb, p_run_at timestamptz default null)
returns public.ai_actions language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  problem text;
  made integer;
  row public.ai_actions;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if p_kind not in ('send_message', 'set_setting', 'mute_chat') then raise exception 'Unknown task.'; end if;

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
    5
  )
  returning * into row;
  return row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Running: the existing master_run, plus mute_chat.
-- ---------------------------------------------------------------------------

create or replace function public.master_run(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  a public.ai_actions;
  problem text;
  conv uuid;
  mins integer;
  before_ timestamptz;
begin
  select * into a from public.ai_actions where id = p_id for update;
  if a is null or a.status not in ('scheduled', 'pending') then return; end if;

  if a.params_hash <> md5(a.kind || coalesce(a.run_at::text, '') || a.params::text) then
    update public.ai_actions set status = 'failed', done_at = now(), result = 'Changed after approval' where id = a.id;
    if a.credits_taken then perform public.ai_refund_credits(a.user_id, a.credits); end if;
    return;
  end if;

  problem := public.master_check(a.user_id, a.kind, a.params, a.id);
  if problem is not null then
    update public.ai_actions set status = 'failed', done_at = now(), result = problem where id = a.id;
    if a.credits_taken then perform public.ai_refund_credits(a.user_id, a.credits); end if;
    return;
  end if;

  if a.kind = 'send_message' then
    insert into public.messages (conversation_id, sender_id, body, meta)
    values (
      (a.params->>'conversation_id')::uuid,
      a.user_id,
      btrim(a.params->>'text'),
      jsonb_build_object('viaAi', true)
    );
  elsif a.kind = 'mute_chat' then
    conv := (a.params->>'conversation_id')::uuid;
    mins := coalesce((a.params->>'minutes')::integer, 0);
    select m.muted_until into before_ from public.conversation_members m
    where m.conversation_id = conv and m.user_id = a.user_id;

    if a.params->>'mode' = 'mute' then
      update public.conversation_members
      set muted_until = case when mins > 0 then now() + make_interval(mins => mins) else 'infinity'::timestamptz end
      where conversation_id = conv and user_id = a.user_id;
    else
      update public.conversation_members set muted_until = null
      where conversation_id = conv and user_id = a.user_id;
      -- "Unmute for a while": remember what it was and put it back later,
      -- but only if it was muted at all, and only if they leave it alone.
      if mins > 0 and before_ is not null and before_ > now() then
        update public.ai_actions
        set undo = jsonb_build_object('conversation_id', conv, 'muted_until', before_),
            undo_at = now() + make_interval(mins => mins)
        where id = a.id;
      end if;
    end if;
  end if;
  -- set_setting is applied by the app on approval; here it is only recorded.

  update public.ai_actions set status = 'done', done_at = now(), result = 'Done' where id = a.id;
exception when others then
  update public.ai_actions set status = 'failed', done_at = now(), result = 'Could not be done'
  where id = p_id and status in ('scheduled', 'pending');
  if a.credits_taken then perform public.ai_refund_credits(a.user_id, a.credits); end if;
end;
$$;
revoke all on function public.master_run(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The clock also puts a temporary unmute back.
-- ---------------------------------------------------------------------------

create or replace function public.master_tick()
returns void language plpgsql security definer set search_path = public as $$
declare
  a record;
begin
  for a in
    select id from public.ai_actions
    where status = 'scheduled' and run_at is not null and run_at <= now()
    order by run_at
    limit 100
    for update skip locked
  loop
    perform public.master_run(a.id);
  end loop;

  for a in
    select id, user_id, undo from public.ai_actions
    where undo is not null and undo_at <= now()
    order by undo_at
    limit 100
    for update skip locked
  loop
    -- Only if it is still unmuted: a mute they set themselves is left alone.
    update public.conversation_members
    set muted_until = (a.undo->>'muted_until')::timestamptz
    where conversation_id = (a.undo->>'conversation_id')::uuid
      and user_id = a.user_id
      and muted_until is null
      and (a.undo->>'muted_until')::timestamptz > now();
    update public.ai_actions set undo = null, undo_at = null where id = a.id;
  end loop;

  update public.ai_actions set status = 'expired' where status = 'pending' and expires_at < now();
end;
$$;
revoke all on function public.master_tick() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Wishes: what people asked for that PINGO AI cannot do yet.
-- ---------------------------------------------------------------------------

create table if not exists public.ai_wishes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  ask text not null check (char_length(ask) between 3 and 300),
  created_at timestamptz not null default now()
);
create index if not exists ai_wishes_user_created on public.ai_wishes (user_id, created_at desc);

alter table public.ai_wishes enable row level security;
revoke all on public.ai_wishes from public, anon, authenticated;

create or replace function public.master_wish(p_ask text)
returns void language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  text_ text := btrim(regexp_replace(coalesce(p_ask, ''), '\s+', ' ', 'g'));
begin
  if me is null or char_length(text_) < 3 then return; end if;
  if (select count(*) from public.ai_wishes where user_id = me and created_at > now() - interval '1 day') >= 10 then
    return;
  end if;
  insert into public.ai_wishes (user_id, ask) values (me, left(text_, 300));
end;
$$;
revoke all on function public.master_wish(text) from public, anon;
grant execute on function public.master_wish(text) to authenticated;

notify pgrst, 'reload schema';
