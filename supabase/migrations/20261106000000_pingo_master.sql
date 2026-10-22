-- PINGO Master: PINGO AI acts for you, inside rules the database enforces.
--
-- The model never gets the service role or a generic API. It gets a short list
-- of tools, and every tool lands here as a *proposal* that sits waiting until a
-- person approves it from the app. Approval is its own call, made by the user's
-- own session; no text written in a chat can approve anything.
--
--   send_message   a message from you, now or later, in a chat you are already in
--   set_setting    a change to one of a few harmless preferences (applied by the
--                  app, recorded here)
--
-- Nothing else exists. Passwords, deleting an account, blocking, devices and
-- payments have no tool, so there is nothing for anyone to talk the AI into.
--
-- A task costs 5 of the day's credits (ai_usage), taken on approval and given
-- back if the task is cancelled or fails.

-- ---------------------------------------------------------------------------
-- What each person has switched on. Everything is off until they turn it on.
-- ---------------------------------------------------------------------------

create table if not exists public.ai_master_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  enabled boolean not null default false,
  allow_messages boolean not null default true,
  allow_settings boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.ai_master_settings enable row level security;
drop policy if exists "own master settings read" on public.ai_master_settings;
create policy "own master settings read" on public.ai_master_settings
  for select to authenticated using (user_id = auth.uid());
revoke all on public.ai_master_settings from public, anon, authenticated;
grant select on public.ai_master_settings to authenticated;

-- ---------------------------------------------------------------------------
-- Every task, and its whole life. This is also the activity log.
-- ---------------------------------------------------------------------------

create table if not exists public.ai_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('send_message', 'set_setting')),
  params jsonb not null,
  -- What was approved is exactly what runs: a changed row no longer matches.
  params_hash text not null,
  status text not null default 'pending'
    check (status in ('pending', 'scheduled', 'done', 'failed', 'cancelled', 'declined', 'expired')),
  run_at timestamptz,
  credits integer not null default 5,
  credits_taken boolean not null default false,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes',
  decided_at timestamptz,
  done_at timestamptz,
  result text
);

create index if not exists ai_actions_user_created on public.ai_actions (user_id, created_at desc);
create index if not exists ai_actions_due on public.ai_actions (run_at) where status = 'scheduled';

alter table public.ai_actions enable row level security;
drop policy if exists "own actions read" on public.ai_actions;
create policy "own actions read" on public.ai_actions
  for select to authenticated using (user_id = auth.uid());
revoke all on public.ai_actions from public, anon, authenticated;
grant select on public.ai_actions to authenticated;

-- ---------------------------------------------------------------------------
-- Limits
-- ---------------------------------------------------------------------------

-- Proposals a person can have made in a day, whatever became of them.
create or replace function public.master_day_cap() returns integer language sql immutable as $$ select 20 $$;
-- Messages PINGO AI may send into one chat for you in a day.
create or replace function public.master_chat_cap() returns integer language sql immutable as $$ select 3 $$;

-- The only settings the AI may change. Anything else is refused here, and the
-- app checks the same list before applying.
create or replace function public.master_setting_ok(p_key text, p_value text)
returns boolean language sql immutable as $$
  select case p_key
    when 'theme' then p_value in ('light', 'dark', 'auto')
    when 'language' then p_value in ('en', 'en-genz', 'hi')
    when 'fontSize' then p_value in ('small', 'medium', 'large')
    when 'muteAll' then p_value in ('true', 'false')
    when 'enterToSend' then p_value in ('true', 'false')
    else false
  end;
$$;

-- A credit refund for the same day it was spent; a new day starts from nothing anyway.
create or replace function public.ai_refund_credits(p_user uuid, p_amount integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.ai_usage
  set credits_used = greatest(0, credits_used - p_amount)
  where user_id = p_user and day = public.ai_today();
end;
$$;
revoke all on function public.ai_refund_credits(uuid, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The person turns Master on or off. Off also stops everything in flight.
-- ---------------------------------------------------------------------------

create or replace function public.master_configure(p_enabled boolean, p_messages boolean, p_settings boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  a record;
begin
  if me is null then raise exception 'Sign in first.'; end if;

  insert into public.ai_master_settings (user_id, enabled, allow_messages, allow_settings, updated_at)
  values (me, p_enabled, p_messages, p_settings, now())
  on conflict (user_id) do update
    set enabled = excluded.enabled,
        allow_messages = excluded.allow_messages,
        allow_settings = excluded.allow_settings,
        updated_at = now();

  -- The kill switch: whatever was waiting is cancelled and its credits returned.
  if not p_enabled or not p_messages then
    for a in
      select * from public.ai_actions
      where user_id = me and status in ('pending', 'scheduled')
        and (not p_enabled or kind = 'send_message')
      for update
    loop
      update public.ai_actions
      set status = 'cancelled', decided_at = now(), result = 'Switched off'
      where id = a.id;
      if a.credits_taken then perform public.ai_refund_credits(me, a.credits); end if;
    end loop;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Checking a proposal. Used when it is made, and again when it runs.
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

-- ---------------------------------------------------------------------------
-- Propose. Called by the AI's tools with the user's own session. Nothing runs.
-- ---------------------------------------------------------------------------

create or replace function public.master_propose(p_kind text, p_params jsonb, p_run_at timestamptz default null)
returns public.ai_actions language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  problem text;
  made integer;
  row public.ai_actions;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if p_kind not in ('send_message', 'set_setting') then raise exception 'Unknown task.'; end if;

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
-- The task itself. Only this function writes the message.
-- ---------------------------------------------------------------------------

create or replace function public.master_run(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  a public.ai_actions;
  problem text;
begin
  select * into a from public.ai_actions where id = p_id for update;
  if a is null or a.status not in ('scheduled', 'pending') then return; end if;

  -- The row must still say what was approved.
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
-- Approve. The one door to running anything, and it is opened by the app.
-- ---------------------------------------------------------------------------

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

  left_ := public.ai_spend_credits(me, a.credits);
  if left_ < 0 then raise exception 'Not enough credits left today.'; end if;

  update public.ai_actions
  set status = 'scheduled', credits_taken = true, decided_at = now()
  where id = a.id;

  -- Now, or later: a task due within the minute runs straight away.
  if a.run_at is null or a.run_at <= now() + interval '1 minute' then
    perform public.master_run(a.id);
  end if;

  select * into a from public.ai_actions where id = a.id;
  return a;
end;
$$;

create or replace function public.master_decline(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.ai_actions set status = 'declined', decided_at = now()
  where id = p_id and user_id = auth.uid() and status = 'pending';
end;
$$;

-- Cancel something scheduled, and take the credits back.
create or replace function public.master_cancel(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  a public.ai_actions;
begin
  select * into a from public.ai_actions where id = p_id and user_id = auth.uid() for update;
  if a is null or a.status not in ('pending', 'scheduled') then return; end if;
  update public.ai_actions set status = 'cancelled', decided_at = now(), result = 'Cancelled' where id = a.id;
  if a.credits_taken then perform public.ai_refund_credits(a.user_id, a.credits); end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- The clock. Every minute: what is due runs, what was never approved expires.
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

  update public.ai_actions set status = 'expired' where status = 'pending' and expires_at < now();
end;
$$;
revoke all on function public.master_tick() from public, anon, authenticated;

select cron.schedule('master-tick', '* * * * *', $$select public.master_tick()$$);

-- ---------------------------------------------------------------------------
-- Finding the chat a name means. Only chats the person is already in, and only
-- the names they already see in their own list; nothing from inside a chat.
-- ---------------------------------------------------------------------------

create or replace function public.master_find_chat(p_query text)
returns table (conversation_id uuid, kind text, title text)
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  q text := btrim(coalesce(p_query, ''));
begin
  if me is null or char_length(q) < 1 then return; end if;
  if not exists (select 1 from public.ai_master_settings s where s.user_id = me and s.enabled) then return; end if;

  return query
    select c.id, c.kind,
           case when c.kind = 'direct' then p.display_name else c.title end
    from public.conversations c
    join public.conversation_members mine
      on mine.conversation_id = c.id and mine.user_id = me and mine.deleted_at is null
    left join public.conversation_members theirs
      on c.kind = 'direct' and theirs.conversation_id = c.id and theirs.user_id <> me
    left join public.profiles p on p.id = theirs.user_id
    where c.kind in ('direct', 'group')
      and (
        (c.kind = 'direct' and (p.display_name ilike '%' || q || '%' or p.username ilike '%' || q || '%'))
        or (c.kind = 'group' and c.title ilike '%' || q || '%')
      )
    order by c.last_message_at desc nulls last
    limit 5;
end;
$$;
revoke all on function public.master_find_chat(text) from public, anon;
grant execute on function public.master_find_chat(text) to authenticated;

revoke all on function public.master_configure(boolean, boolean, boolean) from public, anon;
revoke all on function public.master_propose(text, jsonb, timestamptz) from public, anon;
revoke all on function public.master_approve(uuid) from public, anon;
revoke all on function public.master_decline(uuid) from public, anon;
revoke all on function public.master_cancel(uuid) from public, anon;
grant execute on function public.master_configure(boolean, boolean, boolean) to authenticated;
grant execute on function public.master_propose(text, jsonb, timestamptz) to authenticated;
grant execute on function public.master_approve(uuid) to authenticated;
grant execute on function public.master_decline(uuid) to authenticated;
grant execute on function public.master_cancel(uuid) to authenticated;

notify pgrst, 'reload schema';
