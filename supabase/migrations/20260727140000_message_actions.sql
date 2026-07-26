-- What Level 2 of the context menu needs to actually work.
--
-- docs/13 § 1.2 lists the actions; this is the storage behind the ones that
-- cannot be done in the client alone. Share, Save, Speak, Info and Jump need
-- nothing here — they read what is already on screen or hand off to the
-- platform.

-- ---------------------------------------------------------------------------
-- Editing and deleting
-- ---------------------------------------------------------------------------

-- Soft, not hard. A row that vanishes leaves a hole in every reply that quoted
-- it, and "this message was deleted" is information the thread needs.
alter table public.messages
  add column if not exists deleted_at timestamptz;

/*
 * Edit and delete-for-everyone share one window.
 *
 * Fifteen minutes, enforced here rather than in the client — a client-side
 * limit is a suggestion, and the whole point of the window is that the other
 * person can trust what they read after it.
 */
create or replace function public.edit_message(target uuid, new_body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
begin
  select sender_id, created_at, deleted_at into m
  from public.messages where id = target;

  if m is null or m.sender_id <> auth.uid() or m.deleted_at is not null then
    return;
  end if;
  if now() - m.created_at > interval '15 minutes' then
    return;
  end if;

  update public.messages
     set body = new_body, edited_at = now()
   where id = target;
end;
$$;

create or replace function public.delete_message(target uuid, for_everyone boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
begin
  select sender_id, created_at, conversation_id into m
  from public.messages where id = target;
  if m is null or not public.is_conversation_member(m.conversation_id) then
    return;
  end if;

  if for_everyone then
    -- Only your own, and only inside the window.
    if m.sender_id <> auth.uid() or now() - m.created_at > interval '15 minutes' then
      return;
    end if;
    update public.messages
       set deleted_at = now(), body = '', media_url = null, snap_path = null
     where id = target;
  else
    insert into public.hidden_messages (message_id, user_id)
    values (target, auth.uid())
    on conflict do nothing;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Per-person state: hidden, starred, pinned
-- ---------------------------------------------------------------------------

-- "Delete for me" hides a message from one person without touching what anyone
-- else sees, so it belongs beside the message rather than on it.
create table if not exists public.hidden_messages (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (message_id, user_id)
);

create table if not exists public.starred_messages (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

-- Pinning is per conversation, not per person: a pin is a statement to the
-- room. Anyone in the conversation may pin, and anyone may unpin.
create table if not exists public.pinned_messages (
  message_id uuid primary key references public.messages(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  pinned_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists pinned_messages_conversation_idx
  on public.pinned_messages (conversation_id, created_at desc);

create table if not exists public.message_reminders (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  remind_at timestamptz not null,
  delivered_at timestamptz
);

create table if not exists public.message_reports (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (message_id, reporter_id)
);

alter table public.hidden_messages enable row level security;
alter table public.starred_messages enable row level security;
alter table public.pinned_messages enable row level security;
alter table public.message_reminders enable row level security;
alter table public.message_reports enable row level security;

-- Own-row tables: see, add and remove only what is yours.
do $$
declare t text;
begin
  foreach t in array array['hidden_messages', 'starred_messages', 'message_reminders']
  loop
    execute format('drop policy if exists "mine only" on public.%I', t);
    execute format(
      'create policy "mine only" on public.%I for all to authenticated
         using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end;
$$;

drop policy if exists "pins in my conversations" on public.pinned_messages;
create policy "pins in my conversations"
  on public.pinned_messages for all to authenticated
  using (public.is_conversation_member(conversation_id))
  with check (public.is_conversation_member(conversation_id) and pinned_by = auth.uid());

-- Reports are write-only from the client. Being able to read them back would
-- tell a reporter whether anyone else had reported the same thing.
drop policy if exists "file my own report" on public.message_reports;
create policy "file my own report"
  on public.message_reports for insert to authenticated
  with check (reporter_id = auth.uid());

revoke all on function public.edit_message(uuid, text) from public;
revoke all on function public.delete_message(uuid, boolean) from public;
grant execute on function public.edit_message(uuid, text) to authenticated;
grant execute on function public.delete_message(uuid, boolean) to authenticated;
