-- PINGO AI: side chats (Recents), goals, and a media library.
--
-- ## Side chats
--
-- Every account keeps exactly one main PINGO AI thread: the one in the chat
-- list, made by `ensure_ai_conversation`. Side chats are more threads with the
-- same assistant, listed only inside PINGO AI's drawer ("Recents").
--
-- They are ordinary `kind = 'ai'` conversations with `ai_side = true`, so
-- everything that already serves the main thread serves them unchanged:
-- `ai_may_post`, `post_ai_reply`, `post_ai_photo`, `log_ai_user_turn`, the
-- ai-chat Edge Function's ownership check (RLS: members read their
-- conversations), the notification trigger (a reply notifies the one member,
-- like the main thread) and storage rules for photos (membership).
--
-- Same participants model as the main thread: the owner is the only member;
-- the assistant is not a member, it posts through the security definer
-- functions above.
--
-- Titles: a side chat starts as 'New chat'. After its first reply, ai-chat
-- names it once through `set_ai_side_chat_title`, which only the service role
-- may call (the Edge Function), and only while the title is still the default.
-- The owner renames or deletes it with `rename_ai_side_chat` and
-- `delete_ai_side_chat`.
--
-- ## Goals
--
-- `ai_goals`: a short list the person keeps with PINGO AI ("add a goal to learn
-- tennis"). Owner only, through RLS; ai-chat reads and writes it as the caller.
--
-- ## Library
--
-- No table: `ai_library_page` lists the media in the caller's AI threads
-- (pictures PINGO AI drew, photos and files the person sent it), newest first.
-- Security invoker, so the messages RLS decides exactly as it does for a thread.

-- ---------------------------------------------------------------------------
-- Side chats
-- ---------------------------------------------------------------------------

alter table public.conversations
  add column if not exists ai_side boolean not null default false;

-- A side chat is always an AI thread.
alter table public.conversations drop constraint if exists conversations_ai_side_kind;
alter table public.conversations
  add constraint conversations_ai_side_kind check (not ai_side or kind = 'ai');

create index if not exists conversations_ai_side_owner_idx
  on public.conversations (created_by, last_message_at desc)
  where ai_side;

-- The main thread is never a side chat, whichever is older.
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
    and not c.ai_side
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

/*
 * A new, empty side chat. Returns its id.
 *
 * Capped so a loop in a client cannot fill the table: 500 side chats is far
 * past what a Recents drawer is for, and the oldest can be deleted.
 */
create or replace function public.create_ai_side_chat()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  created uuid;
  owned integer;
begin
  if me is null then
    raise exception 'Sign in required.';
  end if;

  select count(*) into owned
  from public.conversations c
  where c.created_by = me and c.ai_side;

  if owned >= 500 then
    raise exception 'Too many chats. Delete some old ones first.' using errcode = 'AI001';
  end if;

  insert into public.conversations (kind, title, created_by, ai_side)
  values ('ai', 'New chat', me, true)
  returning id into created;

  insert into public.conversation_members (conversation_id, user_id)
  values (created, me);

  insert into public.ai_profiles (user_id)
  values (me)
  on conflict (user_id) do nothing;

  return created;
end;
$$;

revoke all on function public.create_ai_side_chat() from public;
grant execute on function public.create_ai_side_chat() to authenticated;

/* The owner renames a side chat. The main thread keeps PINGO AI's name. */
create or replace function public.rename_ai_side_chat(target uuid, new_title text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  clean text := btrim(regexp_replace(coalesce(new_title, ''), '\s+', ' ', 'g'));
begin
  if me is null then
    raise exception 'Sign in required.';
  end if;

  if char_length(clean) < 1 or char_length(clean) > 80 then
    raise exception 'A chat name is 1 to 80 characters.' using errcode = 'AI002';
  end if;

  update public.conversations c
  set title = clean
  where c.id = target
    and c.ai_side
    and c.created_by = me;

  if not found then
    raise exception 'Chat not found.' using errcode = 'AI003';
  end if;
end;
$$;

revoke all on function public.rename_ai_side_chat(uuid, text) from public;
grant execute on function public.rename_ai_side_chat(uuid, text) to authenticated;

/*
 * The owner deletes a side chat, messages and all (they cascade).
 *
 * Storage objects of photos in it are not removed here; they are left to the
 * media lifecycle like any other unreferenced upload.
 */
create or replace function public.delete_ai_side_chat(target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Sign in required.';
  end if;

  delete from public.conversations c
  where c.id = target
    and c.ai_side
    and c.created_by = me;

  if not found then
    raise exception 'Chat not found.' using errcode = 'AI003';
  end if;
end;
$$;

revoke all on function public.delete_ai_side_chat(uuid) from public;
grant execute on function public.delete_ai_side_chat(uuid) to authenticated;

/*
 * PINGO AI names a side chat after its first reply.
 *
 * Service role only: the ai-chat Edge Function is the one caller, on behalf of
 * `owner` (the signed-in user whose turn it is serving). It never overrides a
 * name: only a side chat of that owner still called 'New chat' changes.
 * Returns whether it did.
 */
create or replace function public.set_ai_side_chat_title(
  target uuid,
  owner uuid,
  new_title text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  clean text := btrim(regexp_replace(coalesce(new_title, ''), '\s+', ' ', 'g'));
begin
  clean := left(clean, 80);
  if char_length(clean) < 1 then
    return false;
  end if;

  update public.conversations c
  set title = clean
  where c.id = target
    and c.ai_side
    and c.created_by = owner
    and (c.title is null or c.title = 'New chat')
    and exists (
      select 1 from public.conversation_members m
      where m.conversation_id = c.id and m.user_id = owner
    );

  return found;
end;
$$;

revoke all on function public.set_ai_side_chat_title(uuid, uuid, text) from public;
revoke all on function public.set_ai_side_chat_title(uuid, uuid, text) from authenticated;
grant execute on function public.set_ai_side_chat_title(uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Goals
-- ---------------------------------------------------------------------------

create table if not exists public.ai_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null,
  done boolean not null default false,
  created_at timestamptz not null default now(),
  done_at timestamptz,
  constraint ai_goals_title_len check (char_length(btrim(title)) between 1 and 120)
);

create index if not exists ai_goals_user_idx on public.ai_goals (user_id, created_at desc);

alter table public.ai_goals enable row level security;

drop policy if exists "own ai goals read" on public.ai_goals;
create policy "own ai goals read"
  on public.ai_goals for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "own ai goals insert" on public.ai_goals;
create policy "own ai goals insert"
  on public.ai_goals for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "own ai goals update" on public.ai_goals;
create policy "own ai goals update"
  on public.ai_goals for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "own ai goals delete" on public.ai_goals;
create policy "own ai goals delete"
  on public.ai_goals for delete to authenticated
  using (user_id = auth.uid());

-- `done_at` follows `done`, whoever writes it (the app or PINGO AI's tool).
create or replace function public.ai_goals_stamp_done()
returns trigger
language plpgsql
as $$
begin
  if new.done and (tg_op = 'INSERT' or not old.done) then
    new.done_at := coalesce(new.done_at, now());
  elsif not new.done then
    new.done_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists ai_goals_stamp_done on public.ai_goals;
create trigger ai_goals_stamp_done
  before insert or update on public.ai_goals
  for each row execute function public.ai_goals_stamp_done();

-- Live in the app's goals list (RLS scopes the stream to the owner).
do $$
begin
  alter publication supabase_realtime add table public.ai_goals;
exception
  when duplicate_object then null;
  when undefined_object then null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Library
-- ---------------------------------------------------------------------------

/*
 * Media in the caller's PINGO AI threads (main and side), newest first.
 *
 * Pictures PINGO AI drew, and photos and files the caller sent it. A
 * view-once photo is left out (it is for one look, not a gallery), as is
 * anything deleted, purged, or before the caller cleared that thread.
 * `before_at` pages: pass the `created_at` of the last row of a page.
 */
create or replace function public.ai_library_page(
  before_at timestamptz default null,
  page_size integer default 60
)
returns table (
  message_id uuid,
  conversation_id uuid,
  sender_id uuid,
  kind text,
  photo_path text,
  file_path text,
  file_name text,
  file_mime text,
  file_size bigint,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select m.id, m.conversation_id, m.sender_id, m.kind::text, m.photo_path, m.file_path,
         m.file_name, m.file_mime, m.file_size::bigint, m.created_at
  from public.conversation_members cm
  join public.conversations c on c.id = cm.conversation_id and c.kind = 'ai'
  join public.messages m on m.conversation_id = c.id
  where cm.user_id = auth.uid()
    and m.deleted_at is null
    and m.media_purged_at is null
    and m.encryption is null
    and (m.sender_id = auth.uid() or m.sender_id = public.pingo_ai_user_id())
    and (
      (m.kind = 'photo' and m.photo_path is not null and m.view_limit is null)
      or (m.kind = 'document' and m.file_path is not null)
    )
    and (cm.cleared_at is null or m.created_at > cm.cleared_at)
    and (before_at is null or m.created_at < before_at)
  order by m.created_at desc
  limit least(greatest(coalesce(page_size, 60), 1), 100);
$$;

revoke all on function public.ai_library_page(timestamptz, integer) from public;
grant execute on function public.ai_library_page(timestamptz, integer) to authenticated;
