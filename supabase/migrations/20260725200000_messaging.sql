-- PINGO — conversations and messages.
--
-- Three tables and two functions. Everything the chat list and a thread need,
-- and nothing yet for calls, moments or the gallery — those get their own
-- migration when their screens stop being fixtures.
--
-- Per-member state (pinned, muted, favourite, read position) lives on the
-- membership row rather than the conversation, because muting is *your*
-- decision about a thread and must not follow everyone else into it.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'direct',
  -- Groups only. A direct chat's title is the other person, resolved per viewer.
  title text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  -- Denormalised so the list can sort without touching `messages`.
  last_message_at timestamptz not null default now(),

  constraint conversations_kind check (kind in ('direct', 'group', 'community'))
);

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  -- Everything after this instant is unread. 'epoch' means "has read nothing".
  last_read_at timestamptz not null default 'epoch',
  pinned boolean not null default false,
  muted boolean not null default false,
  favorite boolean not null default false,

  primary key (conversation_id, user_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null references auth.users (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  edited_at timestamptz,

  constraint messages_body_length check (char_length(body) between 1 and 4000)
);

-- Thread reads are always "this conversation, newest first".
create index if not exists messages_conversation_created_idx
  on public.messages (conversation_id, created_at desc);

create index if not exists conversation_members_user_idx
  on public.conversation_members (user_id);

-- ---------------------------------------------------------------------------
-- Membership test
-- ---------------------------------------------------------------------------
--
-- ⚠️ `security definer` is load-bearing, not a shortcut.
--
-- The obvious policy — "you may read `conversation_members` rows for
-- conversations you are a member of" — has to query `conversation_members` to
-- decide, which re-triggers the same policy, and Postgres fails the query with
-- infinite recursion. Running the check as the definer bypasses RLS *inside the
-- function only*, which breaks the cycle.
--
-- It is safe because the function takes no user identity as an argument: it
-- always asks about `auth.uid()`, so it cannot be called to learn about anyone
-- else's membership.

create or replace function public.is_conversation_member(conv uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.conversation_members m
    where m.conversation_id = conv
      and m.user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- Starting a direct conversation
-- ---------------------------------------------------------------------------
--
-- One round trip, and atomic. Doing this from the client would mean an insert
-- into `conversations` followed by two into `conversation_members`, with a
-- window in between where a conversation exists that nobody can see — including
-- the person who just created it, because the select policy needs a membership
-- row that does not exist yet.
--
-- It is also idempotent: opening the same person twice returns the conversation
-- you already have rather than a second empty one.

create or replace function public.start_direct_conversation(other_user uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  conv uuid;
begin
  if me is null then
    raise exception 'not authenticated';
  end if;

  if other_user = me then
    raise exception 'cannot start a conversation with yourself';
  end if;

  if not exists (select 1 from public.profiles p where p.id = other_user) then
    raise exception 'no such user';
  end if;

  select c.id into conv
  from public.conversations c
  join public.conversation_members mine on mine.conversation_id = c.id and mine.user_id = me
  join public.conversation_members theirs on theirs.conversation_id = c.id and theirs.user_id = other_user
  where c.kind = 'direct'
  limit 1;

  if conv is not null then
    return conv;
  end if;

  insert into public.conversations (kind, created_by)
  values ('direct', me)
  returning id into conv;

  insert into public.conversation_members (conversation_id, user_id)
  values (conv, me), (conv, other_user);

  return conv;
end;
$$;

-- ---------------------------------------------------------------------------
-- Keep `last_message_at` current
-- ---------------------------------------------------------------------------

create or replace function public.touch_conversation_on_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversations
  set last_message_at = new.created_at
  where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists messages_touch_conversation on public.messages;
create trigger messages_touch_conversation
  after insert on public.messages
  for each row execute function public.touch_conversation_on_message();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;

-- Conversations ------------------------------------------------------------

drop policy if exists "members read their conversations" on public.conversations;
create policy "members read their conversations"
  on public.conversations for select
  to authenticated
  using (public.is_conversation_member(id));

-- Insert is allowed so groups can be created later; direct chats go through
-- `start_direct_conversation`, which runs as definer and ignores this.
drop policy if exists "users create conversations" on public.conversations;
create policy "users create conversations"
  on public.conversations for insert
  to authenticated
  with check (created_by = auth.uid());

-- Members ------------------------------------------------------------------

drop policy if exists "members read the roster" on public.conversation_members;
create policy "members read the roster"
  on public.conversation_members for select
  to authenticated
  using (public.is_conversation_member(conversation_id));

-- Only your own row: read position, pin, mute and favourite are personal.
drop policy if exists "members update their own membership" on public.conversation_members;
create policy "members update their own membership"
  on public.conversation_members for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Messages -----------------------------------------------------------------

drop policy if exists "members read messages" on public.messages;
create policy "members read messages"
  on public.messages for select
  to authenticated
  using (public.is_conversation_member(conversation_id));

-- Both halves matter: you must be in the conversation, *and* you may only send
-- as yourself. Without the second, any member could forge another's messages.
drop policy if exists "members send messages" on public.messages;
create policy "members send messages"
  on public.messages for insert
  to authenticated
  with check (
    sender_id = auth.uid()
    and public.is_conversation_member(conversation_id)
  );

drop policy if exists "senders edit their own messages" on public.messages;
create policy "senders edit their own messages"
  on public.messages for update
  to authenticated
  using (sender_id = auth.uid())
  with check (sender_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
--
-- Only `messages`. The conversation list updates from the same events, so
-- publishing `conversations` as well would deliver every row twice.
--
-- Realtime applies RLS to its own stream, so a subscriber still only receives
-- messages from conversations they belong to.

do $$
begin
  alter publication supabase_realtime add table public.messages;
exception
  when duplicate_object then null;
end;
$$;
