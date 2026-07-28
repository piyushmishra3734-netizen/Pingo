-- PINGO — read receipts that arrive while you are still looking.
--
-- Three things were wrong, and they were three symptoms of one gap.
--
-- `conversation_members.last_read_at` already recorded how far each person had
-- read, and the thread turned it into a second tick. But the client read that
-- cursor **once**, when the thread opened, and `conversation_members` was not
-- in the realtime publication — so the only way to learn that someone had read
-- your message was to leave the conversation and come back. Watching someone
-- read what you just sent is the entire point of a read receipt, and it was the
-- one case that could not happen.
--
-- The cursor also cannot answer "*when* did they see it?". It is a moving
-- watermark: once it has passed a message, the moment it passed is gone. So
-- this adds a small history of the cursor's advances.
--
-- ## Why a history of advances, and not a row per message read
--
-- The obvious table is `(message_id, user_id, read_at)` — one row every time
-- anybody reads anything. In a group of twenty that is twenty rows per message,
-- and it grows with *traffic*.
--
-- A cursor advance carries the same information: "at 14:03 I had read
-- everything up to 14:03". One row covers however many messages that catch-up
-- swallowed, and the table grows with **how often people open the chat**, not
-- with how much is said in it. Opening a thread with nothing new in it writes
-- nothing at all.
--
-- Recovering a single message's read time is then a range lookup: the earliest
-- advance whose watermark reached it.

-- ---------------------------------------------------------------------------
-- The history
-- ---------------------------------------------------------------------------

create table if not exists public.conversation_reads (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Everything sent at or before this instant had been read...
  upto timestamptz not null,
  -- ...and this is when the reading happened. The two differ by however long
  -- the messages sat unread, which is exactly the fact being recorded.
  at timestamptz not null default now(),

  primary key (conversation_id, user_id, upto)
);

-- The lookup is always "this person, in this conversation, whose watermark
-- first reached this message" — so the index is ordered to let `upto >= t`
-- terminate at the first match.
create index if not exists conversation_reads_lookup_idx
  on public.conversation_reads (conversation_id, user_id, upto);

alter table public.conversation_reads enable row level security;

-- Members of the conversation may see who has read it. That is what a receipt
-- *is*; a receipt only you could see would be pointless.
drop policy if exists "members read receipts" on public.conversation_reads;
create policy "members read receipts"
  on public.conversation_reads for select
  to authenticated
  using (public.is_conversation_member(conversation_id));

-- Nobody writes this table directly. `mark_conversation_read` is the only way
-- in, which is what stops anyone from forging a receipt in either direction --
-- claiming they read something later than they did, or claiming someone else
-- read something they never opened.

-- ---------------------------------------------------------------------------
-- Marking a conversation read
-- ---------------------------------------------------------------------------
--
-- Was a plain `update conversation_members set last_read_at = now()` from the
-- client. It still is, plus the history row — but doing it here means the two
-- cannot disagree, and means the client cannot set a cursor it did not earn.

create or replace function public.mark_conversation_read(conv uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  previous timestamptz;
  now_at timestamptz := now();
begin
  if me is null then
    raise exception 'not authenticated';
  end if;

  select m.last_read_at into previous
  from public.conversation_members m
  where m.conversation_id = conv and m.user_id = me;

  -- Not a member: say nothing either way. Raising here would let anyone probe
  -- for the existence of a conversation by the shape of the error.
  if previous is null then
    return;
  end if;

  /*
   * Only record an advance that actually caught up on something.
   *
   * Re-opening a thread you have already read moves the cursor to `now()` and
   * changes nothing anyone can observe — writing a history row for it would
   * fill the table with "I looked again", and would make a later lookup for a
   * message's read time return the *re-read* rather than the first read.
   *
   * Your own messages do not count. Nobody wants a receipt saying they read
   * themselves.
   */
  if exists (
    select 1
    from public.messages msg
    where msg.conversation_id = conv
      and msg.sender_id <> me
      and msg.created_at > previous
      and msg.created_at <= now_at
  ) then
    insert into public.conversation_reads (conversation_id, user_id, upto, at)
    values (conv, me, now_at, now_at)
    on conflict do nothing;
  end if;

  update public.conversation_members
  set last_read_at = now_at
  where conversation_id = conv and user_id = me;
end;
$$;

revoke all on function public.mark_conversation_read(uuid) from public;
grant execute on function public.mark_conversation_read(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Who has read one particular message, and when
-- ---------------------------------------------------------------------------
--
-- What the message-info screen shows. One row per *other* member, so a group
-- of six returns five rows whether they have read it or not — `read_at` is
-- null for the ones who have not, because "waiting on Priya" is as much of an
-- answer as "Priya read it at 14:03".

create or replace function public.message_receipts(msg uuid)
returns table (user_id uuid, read_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  conv uuid;
  sent_at timestamptz;
  sender uuid;
begin
  select m.conversation_id, m.created_at, m.sender_id
  into conv, sent_at, sender
  from public.messages m
  where m.id = msg;

  if conv is null then
    return;
  end if;

  -- `security definer` bypasses RLS, so membership is checked by hand. Without
  -- this, any message id would hand back its readers.
  if not public.is_conversation_member(conv) then
    return;
  end if;

  return query
  select
    mem.user_id,
    coalesce(
      /*
       * The first advance whose watermark reached this message. `min` rather
       * than "the latest" on purpose: someone who reads at 14:03 and opens the
       * thread again at 18:00 saw it at 14:03.
       */
      (
        select min(r.at)
        from public.conversation_reads r
        where r.conversation_id = conv
          and r.user_id = mem.user_id
          and r.upto >= sent_at
      ),
      /*
       * Messages read before this table existed have no advance recorded. The
       * cursor still proves they were read, so fall back to it — the time will
       * be the last time that person opened the thread rather than the moment
       * they saw this, which is the best that can honestly be said about a
       * receipt that was never written down.
       */
      case when mem.last_read_at >= sent_at then mem.last_read_at end
    ) as read_at
  from public.conversation_members mem
  where mem.conversation_id = conv
    and mem.user_id <> sender;
end;
$$;

revoke all on function public.message_receipts(uuid) from public;
grant execute on function public.message_receipts(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
--
-- The missing half. `messages` has been published since the first migration, so
-- a message arrives live — but the acknowledgement that it was *read* travelled
-- only on a page load.
--
-- Realtime applies the table's own RLS to its stream, and the select policy on
-- `conversation_members` is already "members of that conversation", so this
-- reveals nothing that a member could not read directly.

do $$
begin
  alter publication supabase_realtime add table public.conversation_members;
exception
  when duplicate_object then null;
end;
$$;
