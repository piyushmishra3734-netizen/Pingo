-- Notifications: one feed of everything that happened to you.
--
-- ## Why a table and not a derived view
--
-- The events come from unrelated places — a follow row, a message row, a story
-- — and a view unioning them would have to re-scan all of those on every open,
-- with no way to record what has been read. A row per event is written once and
-- read cheaply.
--
-- ## Why triggers and not application code
--
-- The client that inserts a message is not the only thing that can insert one,
-- and a notification written by the sender is a notification that goes missing
-- the moment anything else writes a row. Triggers fire for every writer.
--
-- ## Read state is a timestamp, not a boolean
--
-- `read_at` answers "when", which a boolean cannot, and marking everything read
-- becomes one update against a cursor rather than a write per row.

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  -- Who this is *for*. Every query starts here, hence the index below.
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Who caused it. Null for anything the system itself raises.
  actor_id uuid references auth.users(id) on delete cascade,
  kind text not null check (
    kind in ('follow_request', 'follow_accepted', 'message', 'snap', 'story')
  ),
  /*
   * What the notification points at — a conversation, a story, a message.
   * Deliberately untyped and unconstrained: a foreign key per kind would mean
   * a column per kind, and a row that is only ever one of them.
   */
  subject_id uuid,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists notifications_user_unread_idx
  on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists "read my notifications" on public.notifications;
create policy "read my notifications"
  on public.notifications for select to authenticated
  using (user_id = auth.uid());

-- Only marking as read. There is no insert policy on purpose: rows are written
-- exclusively by the security-definer triggers below, so nobody can fabricate a
-- notification for someone else.
drop policy if exists "mark my notifications read" on public.notifications;
create policy "mark my notifications read"
  on public.notifications for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "delete my notifications" on public.notifications;
create policy "delete my notifications"
  on public.notifications for delete to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Writer
-- ---------------------------------------------------------------------------

/*
 * The only way a row is created.
 *
 * `security definer` so triggers can write on behalf of a user who has no
 * insert policy, and never raises — a failed notification must not roll back
 * the message or follow that caused it.
 */
create or replace function public.notify_user(
  target uuid,
  actor uuid,
  event_kind text,
  subject uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Never notify someone about their own action.
  if target is null or target = actor then
    return;
  end if;

  insert into public.notifications (user_id, actor_id, kind, subject_id)
  values (target, actor, event_kind, subject);
exception
  when others then
    return;
end;
$$;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create or replace function public.on_follow_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' and new.status = 'pending' then
    perform public.notify_user(new.followee_id, new.follower_id, 'follow_request', null);
  elsif tg_op = 'UPDATE' and new.status = 'accepted' and old.status <> 'accepted' then
    -- The person who *asked* is the one who wants to hear about the accept.
    perform public.notify_user(new.follower_id, new.followee_id, 'follow_accepted', null);
  end if;
  return new;
end;
$$;

drop trigger if exists follows_notify on public.follows;
create trigger follows_notify
  after insert or update on public.follows
  for each row execute function public.on_follow_change();

/*
 * One notification per recipient, not per conversation.
 *
 * A group of five means four rows. That is the point: the feed belongs to a
 * person, so it has to be fanned out at write time rather than resolved per
 * reader at read time.
 */
create or replace function public.on_message_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  member record;
begin
  for member in
    select user_id from public.conversation_members
    where conversation_id = new.conversation_id and user_id <> new.sender_id
  loop
    perform public.notify_user(
      member.user_id,
      new.sender_id,
      case when new.kind = 'snap' then 'snap' else 'message' end,
      new.conversation_id
    );
  end loop;
  return new;
end;
$$;

drop trigger if exists messages_notify on public.messages;
create trigger messages_notify
  after insert on public.messages
  for each row execute function public.on_message_insert();

-- ---------------------------------------------------------------------------
-- Reading
-- ---------------------------------------------------------------------------

/** Unread count for the badge. One number, one round trip. */
create or replace function public.unread_notifications()
returns integer
language sql
security definer
set search_path = public
stable
as $$
  select count(*)::integer
  from public.notifications
  where user_id = auth.uid() and read_at is null;
$$;

/** Marks everything read in one statement rather than a write per row. */
create or replace function public.mark_notifications_read()
returns void
language sql
security definer
set search_path = public
as $$
  update public.notifications
     set read_at = now()
   where user_id = auth.uid() and read_at is null;
$$;

revoke all on function public.notify_user(uuid, uuid, text, uuid) from public;
revoke all on function public.unread_notifications() from public;
revoke all on function public.mark_notifications_read() from public;

grant execute on function public.unread_notifications() to authenticated;
grant execute on function public.mark_notifications_read() to authenticated;
-- `notify_user` is deliberately not granted: triggers reach it as definer, and
-- a client that could call it could forge notifications for anyone.
