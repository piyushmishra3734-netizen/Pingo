-- Archiving, clearing, deleting and organising conversations.
--
-- ## Everything here is per member, not per conversation
--
-- Archiving a chat is a statement about your own list, not about the chat. The
-- other person must not see their copy move, so every flag added here lives on
-- `conversation_members` beside `pinned`, `muted` and `favorite`, which already
-- worked this way. There is no conversation-level equivalent of any of them and
-- there should not be.
--
-- ## Why deleting a chat is two timestamps rather than a row disappearing
--
-- Deleting your membership would be wrong twice over: you would stop receiving
-- the conversation entirely, and re-creating it later would produce a second
-- one. So a deleted chat is a chat you have hidden up to a point in time —
-- `cleared_at` hides the messages, `deleted_at` hides the row itself, and the
-- row comes back on its own when someone says something newer. That is what
-- every messaging product actually does, and it is why a deleted chat
-- reappearing with only the new message is the expected behaviour rather than a
-- bug.
--
-- Clearing without deleting is the same mechanism with one of the two set,
-- which is why they are separate columns and not one.

alter table public.conversation_members
  add column if not exists archived_at timestamptz,
  -- "Mark as unread" is a deliberate state, not a count. It cannot be derived
  -- from `last_read_at`, because the whole point is that you *have* read it and
  -- want the list to disagree.
  add column if not exists marked_unread boolean not null default false,
  -- Messages at or before this are hidden from this member only.
  add column if not exists cleared_at timestamptz,
  -- The row is hidden from this member's list until something newer arrives.
  add column if not exists deleted_at timestamptz;

create index if not exists conversation_members_archived_idx
  on public.conversation_members (user_id)
  where archived_at is not null;

-- ---------------------------------------------------------------------------
-- Custom lists
-- ---------------------------------------------------------------------------

-- A list belongs to one person. Two people can both have a "Work" list and they
-- are unrelated, which is why the name is unique per owner rather than globally.
create table if not exists public.chat_lists (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),

  constraint chat_lists_name_length check (char_length(trim(name)) between 1 and 40),
  constraint chat_lists_name_unique unique (owner_id, name)
);

-- A conversation may be in several lists, so this is a join table rather than a
-- column. "Work and Travel" is a normal thing for one chat to be.
create table if not exists public.chat_list_members (
  list_id uuid not null references public.chat_lists (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  primary key (list_id, conversation_id)
);

create index if not exists chat_lists_owner_idx on public.chat_lists (owner_id);

alter table public.chat_lists enable row level security;
alter table public.chat_list_members enable row level security;

drop policy if exists "own lists" on public.chat_lists;
create policy "own lists" on public.chat_lists
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

/*
 * Membership is reachable only through a list you own. Checking the conversation
 * as well would be redundant — you cannot name a list you do not own, so there
 * is no way to file someone else's chat anywhere.
 */
drop policy if exists "own list members" on public.chat_list_members;
create policy "own list members" on public.chat_list_members
  for all to authenticated
  using (
    exists (
      select 1 from public.chat_lists l
      where l.id = list_id and l.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.chat_lists l
      where l.id = list_id and l.owner_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Previews, updated for the new flags
-- ---------------------------------------------------------------------------

/*
 * Replaces the version from `20260728000000`, with three changes:
 *
 *   - Messages at or before `cleared_at` are not this member's newest, so a
 *     cleared chat shows no preview rather than the message it just hid.
 *   - `marked_unread` reports as one unread, because the list has exactly one
 *     way to say "this wants you" and inventing a second would mean every row
 *     and badge learning about a third state.
 *   - `archived` and `deleted` come back with the row, so the client filters on
 *     facts rather than re-deriving them from timestamps it would have to fetch
 *     separately.
 */
-- Dropped rather than replaced: `create or replace` cannot change a function's
-- return type, and this one gains two columns.
drop function if exists public.conversation_previews();

create function public.conversation_previews()
returns table (
  conversation_id uuid,
  last_message_id uuid,
  unread_count integer,
  archived boolean,
  deleted boolean
)
language sql
security definer
set search_path = public
stable
as $$
  with mine as (
    select
      m.conversation_id,
      m.last_read_at,
      m.marked_unread,
      m.archived_at,
      m.cleared_at,
      m.deleted_at
    from public.conversation_members m
    where m.user_id = auth.uid()
  ),
  visible as (
    select msg.*
    from public.messages msg
    join mine on mine.conversation_id = msg.conversation_id
    where (mine.cleared_at is null or msg.created_at > mine.cleared_at)
      and not exists (
        select 1 from public.hidden_messages h
        where h.message_id = msg.id and h.user_id = auth.uid()
      )
  ),
  newest as (
    select distinct on (v.conversation_id) v.conversation_id, v.id, v.created_at
    from visible v
    order by v.conversation_id, v.created_at desc
  ),
  unread as (
    select
      mine.conversation_id,
      count(v.id)::integer as unread_count
    from mine
    left join visible v
      on v.conversation_id = mine.conversation_id
      and v.sender_id <> auth.uid()
      and v.created_at > mine.last_read_at
    group by mine.conversation_id
  )
  select
    mine.conversation_id,
    newest.id as last_message_id,
    case
      when mine.marked_unread then greatest(coalesce(unread.unread_count, 0), 1)
      else coalesce(unread.unread_count, 0)
    end as unread_count,
    (mine.archived_at is not null) as archived,
    /*
     * Deleted only while nothing has happened since. A chat someone has replied
     * to is not deleted any more, and requiring an explicit undelete would mean
     * their message silently going nowhere.
     */
    (
      mine.deleted_at is not null
      and (newest.created_at is null or newest.created_at <= mine.deleted_at)
    ) as deleted
  from mine
  left join newest on newest.conversation_id = mine.conversation_id
  left join unread on unread.conversation_id = mine.conversation_id;
$$;

revoke all on function public.conversation_previews() from public;
grant execute on function public.conversation_previews() to authenticated;
