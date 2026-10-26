-- Private chat, phase 1: a temporary end-to-end encrypted session in a one to
-- one chat. See docs/private-chat-plan.md.
--
-- ## What is stored, and for how long
--
-- A session is two public keys and a clock. The messages in it are ciphertext
-- the server cannot read (AES-GCM under a key only the two phones can derive).
-- When the session ends, by either person or by 3 hours without activity, its
-- messages are deleted and both public keys are wiped; what is left is a row
-- with no key and no content, kept 24 hours only so the start limits can count.
--
-- ## Why it is cheap
--
-- Everything is separate from `messages`, so nothing here touches a normal
-- chat. One start is one small row. The cleanup job reads an index of the
-- sessions that have expired, a hundred at a time; it never scans a big table.
-- The whole feature is behind `app_flag('private_chat')`, off until turned on.

create table if not exists public.private_sessions (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  creator_id uuid not null references auth.users (id) on delete cascade,
  peer_id uuid not null references auth.users (id) on delete cascade,
  creator_pub text,
  peer_pub text,
  state text not null default 'active' check (state in ('active', 'ended')),
  started_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '3 hours',
  ended_at timestamptz,
  ended_by uuid references auth.users (id) on delete set null,
  constraint private_sessions_distinct check (creator_id <> peer_id),
  constraint private_sessions_pub_size check (
    (creator_pub is null or length(creator_pub) between 60 and 200)
    and (peer_pub is null or length(peer_pub) between 60 and 200)
  )
);

-- One live session per chat.
create unique index if not exists private_sessions_one_active
  on public.private_sessions (conversation_id) where state = 'active';
-- What the start limits count.
create index if not exists private_sessions_creator_started
  on public.private_sessions (creator_id, started_at desc);
create index if not exists private_sessions_conversation_started
  on public.private_sessions (conversation_id, started_at desc);
-- What the cleanup job reads: only live sessions, by when they expire.
create index if not exists private_sessions_expiry
  on public.private_sessions (expires_at) where state = 'active';
-- The other person's app looks for a session addressed to them.
create index if not exists private_sessions_peer_active
  on public.private_sessions (peer_id) where state = 'active';
-- Ended rows are removed after a day.
create index if not exists private_sessions_ended
  on public.private_sessions (ended_at) where state = 'ended';

create table if not exists public.private_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.private_sessions (id) on delete cascade,
  sender_id uuid not null references auth.users (id) on delete cascade,
  ct text not null check (length(ct) <= 24000),
  created_at timestamptz not null default now()
);

create index if not exists private_messages_session
  on public.private_messages (session_id, created_at);

alter table public.private_sessions enable row level security;
alter table public.private_messages enable row level security;

revoke all on public.private_sessions from anon, authenticated;
revoke all on public.private_messages from anon, authenticated;
grant select on public.private_sessions to authenticated;
grant select on public.private_messages to authenticated;

drop policy if exists "members read their private session" on public.private_sessions;
create policy "members read their private session"
  on public.private_sessions for select to authenticated
  using (auth.uid() = creator_id or auth.uid() = peer_id);

drop policy if exists "members read their private messages" on public.private_messages;
create policy "members read their private messages"
  on public.private_messages for select to authenticated
  using (
    exists (
      select 1 from public.private_sessions s
      where s.id = private_messages.session_id
        and (auth.uid() = s.creator_id or auth.uid() = s.peer_id)
    )
  );
-- No insert, update or delete policy: every write goes through the functions below.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'private_sessions'
  ) then
    alter publication supabase_realtime add table public.private_sessions;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'private_messages'
  ) then
    alter publication supabase_realtime add table public.private_messages;
  end if;
end $$;

insert into public.app_flags (key, enabled, note)
values (
  'private_chat',
  false,
  'Private chat: temporary end-to-end encrypted sessions in one to one chats. Off = nobody can start one; sessions already running still end and clean up.'
)
on conflict (key) do nothing;

/*
 * Start a session. `p_pub` is the creator's temporary public key; the private
 * half never leaves their phone.
 *
 * The limits are checked here, not in the app, because a person who wants to
 * flip it on and off for fun will not be using the app's buttons. Placeholder
 * numbers; change them with `create or replace`, no release needed:
 *   60 s between one ending and the next starting in the same chat;
 *   5 starts per hour and 20 per day per person; 3 per hour per chat.
 */
create or replace function public.private_start(p_conversation_id uuid, p_pub text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  peer uuid;
  kind text;
  live record;
  recent integer;
  sid uuid;
begin
  if me is null then raise exception 'Sign in first.'; end if;
  if not public.app_flag('private_chat') then
    raise exception 'Private chat is not available yet.';
  end if;
  if not public.is_conversation_member(p_conversation_id) then
    raise exception 'You are not in this chat.';
  end if;

  select c.kind into kind from public.conversations c where c.id = p_conversation_id;
  if kind is distinct from 'direct' then
    raise exception 'Private chat works in one to one chats only.';
  end if;

  select m.user_id into peer
  from public.conversation_members m
  where m.conversation_id = p_conversation_id and m.user_id <> me
  limit 1;
  if peer is null then raise exception 'Nobody to chat with here.'; end if;
  if peer = 'a1000000-0000-4000-8000-0000000000a1'::uuid then
    raise exception 'Private chat is not available with PINGO AI.';
  end if;

  if exists (
    select 1 from public.blocks b
    where (b.blocker_id = me and b.blocked_id = peer) or (b.blocker_id = peer and b.blocked_id = me)
  ) then
    raise exception 'Private chat is not available with this person.';
  end if;

  -- Already on: hand back the live one rather than refusing.
  select s.id, s.expires_at into live
  from public.private_sessions s
  where s.conversation_id = p_conversation_id and s.state = 'active';
  if found then
    if live.expires_at > now() then return live.id; end if;
    perform public.private_end_session(live.id, null);
  end if;

  if exists (
    select 1 from public.private_sessions s
    where s.conversation_id = p_conversation_id and s.ended_at > now() - interval '60 seconds'
  ) then
    raise exception 'Give it a minute before starting another private chat.';
  end if;

  select count(*) into recent from public.private_sessions s
  where s.creator_id = me and s.started_at > now() - interval '1 hour';
  if recent >= 5 then raise exception 'Too many private chats started. Try again in a while.'; end if;

  select count(*) into recent from public.private_sessions s
  where s.creator_id = me and s.started_at > now() - interval '1 day';
  if recent >= 20 then raise exception 'Too many private chats started today.'; end if;

  select count(*) into recent from public.private_sessions s
  where s.conversation_id = p_conversation_id and s.started_at > now() - interval '1 hour';
  if recent >= 3 then raise exception 'This chat has started a lot of private chats. Try again in a while.'; end if;

  insert into public.private_sessions (conversation_id, creator_id, peer_id, creator_pub)
  values (p_conversation_id, me, peer, p_pub)
  returning id into sid;
  return sid;
end;
$$;

/* The other person's phone adds its temporary public key, by itself. */
create or replace function public.private_join(p_session uuid, p_pub text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.private_sessions s
     set peer_pub = p_pub
   where s.id = p_session
     and s.peer_id = auth.uid()
     and s.state = 'active'
     and s.expires_at > now()
     and s.peer_pub is null;
  if not found then
    if not exists (
      select 1 from public.private_sessions s
      where s.id = p_session and s.peer_id = auth.uid() and s.peer_pub is not null
    ) then
      raise exception 'That private chat is not open.';
    end if;
  end if;
end;
$$;

/* One message, already encrypted. Each one keeps the session alive for 3 more hours. */
create or replace function public.private_send(p_session uuid, p_ct text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  mid uuid;
  at timestamptz;
begin
  perform 1 from public.private_sessions s
  where s.id = p_session
    and s.state = 'active'
    and s.expires_at > now()
    and (s.creator_id = me or s.peer_id = me);
  if not found then raise exception 'That private chat is over.'; end if;

  insert into public.private_messages (session_id, sender_id, ct)
  values (p_session, me, p_ct)
  returning id, created_at into mid, at;

  update public.private_sessions
     set last_activity_at = now(), expires_at = now() + interval '3 hours'
   where id = p_session;

  return jsonb_build_object('id', mid, 'created_at', at);
end;
$$;

/*
 * The end, for both people: the messages go and so do both public keys.
 * Internal; `private_end` is the one a person can call.
 */
create or replace function public.private_end_session(p_session uuid, p_by uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.private_messages where session_id = p_session;
  update public.private_sessions
     set state = 'ended',
         ended_at = now(),
         ended_by = p_by,
         creator_pub = null,
         peer_pub = null
   where id = p_session and state = 'active';
end;
$$;

revoke all on function public.private_end_session(uuid, uuid) from public, anon, authenticated;

create or replace function public.private_end(p_session uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.private_sessions s
    where s.id = p_session and (s.creator_id = auth.uid() or s.peer_id = auth.uid())
  ) then
    raise exception 'That private chat is not yours.';
  end if;
  perform public.private_end_session(p_session, auth.uid());
end;
$$;

/*
 * Every minute: end the sessions that ran out, and drop ended rows after a day.
 * Both read an index and take a bounded batch.
 */
create or replace function public.private_sweep()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
  n integer := 0;
begin
  for s in
    select id from public.private_sessions
    where state = 'active' and expires_at < now()
    order by expires_at
    limit 100
    for update skip locked
  loop
    perform public.private_end_session(s.id, null);
    n := n + 1;
  end loop;

  delete from public.private_sessions
  where id in (
    select id from public.private_sessions
    where state = 'ended' and ended_at < now() - interval '1 day'
    limit 500
  );
  return n;
end;
$$;

revoke all on function public.private_sweep() from public, anon, authenticated;

revoke execute on function public.private_start(uuid, text) from public, anon;
revoke execute on function public.private_join(uuid, text) from public, anon;
revoke execute on function public.private_send(uuid, text) from public, anon;
revoke execute on function public.private_end(uuid) from public, anon;
grant execute on function public.private_start(uuid, text) to authenticated;
grant execute on function public.private_join(uuid, text) to authenticated;
grant execute on function public.private_send(uuid, text) to authenticated;
grant execute on function public.private_end(uuid) to authenticated;

select cron.schedule('private-sweep', '* * * * *', $$select public.private_sweep()$$);

notify pgrst, 'reload schema';
