-- PINGO AI: a first-class conversation kind that still looks like a person in Chats.
--
-- Not E2EE: the server must read messages to generate replies. RLS keeps the
-- thread private to its owner. The product surface is the privacy notice, not a
-- lock icon that would imply end-to-end encryption.

-- ---------------------------------------------------------------------------
-- Conversation kind
-- ---------------------------------------------------------------------------

alter table public.conversations drop constraint if exists conversations_kind;
alter table public.conversations
  add constraint conversations_kind
  check (kind in ('direct', 'group', 'community', 'ai'));

-- ---------------------------------------------------------------------------
-- Fixed AI identity (for message.sender_id bubble alignment)
-- ---------------------------------------------------------------------------
--
-- A single system user so assistant rows render as "them", not "me". Not a
-- login. Profiles row is a default face; per-user name/avatar live in ai_profiles.

create or replace function public.pingo_ai_user_id()
returns uuid
language sql
immutable
as $$
  select 'a1000000-0000-4000-8000-0000000000a1'::uuid;
$$;

-- Seed auth.users + profile if missing (idempotent).
do $$
declare
  bot uuid := public.pingo_ai_user_id();
begin
  if not exists (select 1 from auth.users where id = bot) then
    insert into auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      is_sso_user,
      is_anonymous
    ) values (
      '00000000-0000-0000-0000-000000000000',
      bot,
      'authenticated',
      'authenticated',
      'pingo-ai@system.local',
      crypt('pingo-ai-no-login', gen_salt('bf')),
      now(),
      '{"provider":"system","providers":["system"]}'::jsonb,
      '{"display_name":"PINGO"}'::jsonb,
      now(),
      now(),
      false,
      false
    );
  end if;

  insert into public.profiles (id, username, display_name, bio)
  values (bot, 'pingo_ai', 'PINGO', null)
  on conflict (id) do nothing;
exception
  when others then
    -- Auth schema differs across projects; ensure_ai_conversation still works
    -- if the bot user was created manually or already exists.
    raise notice 'pingo_ai user seed skipped: %', sqlerrm;
end;
$$;

-- ---------------------------------------------------------------------------
-- Per-user AI prefs
-- ---------------------------------------------------------------------------

create table if not exists public.ai_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default 'PINGO',
  avatar_url text,
  personality text not null default 'friendly',
  custom_personality text,
  response_length text not null default 'short'
    check (response_length in ('short', 'balanced', 'detailed')),
  preferred_name text,
  age integer check (age is null or (age >= 13 and age <= 120)),
  language text,
  country text,
  memory_enabled boolean not null default false,
  onboarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_profiles_personality check (
    personality in (
      'friendly', 'genz', 'coach', 'study', 'calm',
      'funny', 'motivator', 'creative', 'custom'
    )
  )
);

alter table public.ai_profiles enable row level security;

drop policy if exists "own ai profile" on public.ai_profiles;
create policy "own ai profile"
  on public.ai_profiles for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create table if not exists public.ai_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  key text not null,
  value text not null,
  created_at timestamptz not null default now(),
  constraint ai_memories_key_len check (char_length(key) between 1 and 80),
  constraint ai_memories_value_len check (char_length(value) between 1 and 500)
);

create index if not exists ai_memories_user_idx on public.ai_memories (user_id);

alter table public.ai_memories enable row level security;

drop policy if exists "own ai memories" on public.ai_memories;
create policy "own ai memories"
  on public.ai_memories for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Processing copies for the model (not the user's visible history).
create table if not exists public.ai_processing_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists ai_processing_log_created_idx
  on public.ai_processing_log (created_at);

alter table public.ai_processing_log enable row level security;
-- No client policies: only service role / security definer writes.

-- ---------------------------------------------------------------------------
-- Ensure one AI conversation per user
-- ---------------------------------------------------------------------------

create or replace function public.ensure_ai_conversation()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  existing uuid;
  created uuid;
  bot uuid := public.pingo_ai_user_id();
begin
  if me is null then
    raise exception 'Sign in required.';
  end if;

  select c.id into existing
  from public.conversations c
  join public.conversation_members m on m.conversation_id = c.id
  where c.kind = 'ai'
    and m.user_id = me
    and m.deleted_at is null
  order by c.created_at asc
  limit 1;

  if existing is not null then
    return existing;
  end if;

  insert into public.conversations (kind, title, created_by)
  values ('ai', 'PINGO', me)
  returning id into created;

  insert into public.conversation_members (conversation_id, user_id, pinned)
  values (created, me, true);

  insert into public.ai_profiles (user_id)
  values (me)
  on conflict (user_id) do nothing;

  -- Quiet first message from the AI identity (person-shaped, not a system banner).
  insert into public.messages (conversation_id, sender_id, body, kind)
  values (
    created,
    bot,
    'Hey. I''m here whenever you want to talk.',
    'text'
  );

  update public.conversations
  set last_message_at = now()
  where id = created;

  return created;
end;
$$;

revoke all on function public.ensure_ai_conversation() from public;
grant execute on function public.ensure_ai_conversation() to authenticated;

-- ---------------------------------------------------------------------------
-- Insert assistant message (Edge Function / client after stream completes)
-- ---------------------------------------------------------------------------

create or replace function public.post_ai_reply(
  target_conversation uuid,
  reply_body text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  bot uuid := public.pingo_ai_user_id();
  msg_id uuid;
  k text;
begin
  if me is null then
    raise exception 'Sign in required.';
  end if;

  if reply_body is null or char_length(trim(reply_body)) = 0 then
    raise exception 'Empty reply.';
  end if;

  select c.kind into k
  from public.conversations c
  join public.conversation_members m on m.conversation_id = c.id
  where c.id = target_conversation
    and m.user_id = me
    and m.deleted_at is null;

  if k is distinct from 'ai' then
    raise exception 'Not an AI conversation.';
  end if;

  insert into public.messages (conversation_id, sender_id, body, kind)
  values (target_conversation, bot, left(trim(reply_body), 4000), 'text')
  returning id into msg_id;

  update public.conversations
  set last_message_at = now()
  where id = target_conversation;

  insert into public.ai_processing_log (user_id, conversation_id, role, body)
  values (me, target_conversation, 'assistant', left(trim(reply_body), 4000));

  return msg_id;
end;
$$;

revoke all on function public.post_ai_reply(uuid, text) from public;
grant execute on function public.post_ai_reply(uuid, text) to authenticated;

-- Log user turns for processing (optional; Edge can also write via service role).
create or replace function public.log_ai_user_turn(
  target_conversation uuid,
  turn_body text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  k text;
begin
  if me is null then return; end if;

  select c.kind into k
  from public.conversations c
  join public.conversation_members m on m.conversation_id = c.id
  where c.id = target_conversation and m.user_id = me;

  if k is distinct from 'ai' then return; end if;

  insert into public.ai_processing_log (user_id, conversation_id, role, body)
  values (me, target_conversation, 'user', left(coalesce(turn_body, ''), 4000));
end;
$$;

revoke all on function public.log_ai_user_turn(uuid, text) from public;
grant execute on function public.log_ai_user_turn(uuid, text) to authenticated;

-- Purge processing copies older than 24 hours (call from cron or Edge).
create or replace function public.purge_ai_processing_log()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  delete from public.ai_processing_log
  where created_at < now() - interval '24 hours';
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.purge_ai_processing_log() from public;
grant execute on function public.purge_ai_processing_log() to service_role;
