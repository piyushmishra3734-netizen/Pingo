-- A direct chat nobody has said anything in is not a conversation yet.
--
-- ## The rule
--
-- Every messenger the product is compared to agrees on this one: a thread
-- appears in the chat list when somebody sends something into it - either
-- side, one message is enough - and not before. Until then the other person's
-- name belongs in search, in contacts, on their profile: places you go looking
-- for somebody, not a list that claims they talked to you.
--
-- ## Where the empty threads came from
--
-- Three writers make a conversation row before any words exist in it:
--
--   - `redeem_referral` opens a direct thread between inviter and invitee the
--     moment a referral code is used. Well meant - "here is the person you
--     brought" - but it put a stranger's name at the top of both lists while
--     neither had said a thing.
--   - The Message button on a profile calls `start_direct_conversation` before
--     navigating, so backing out of an untouched thread left it behind.
--   - Story replies and community actions route through the same RPC.
--
-- All three are correct about *creating* the row - the sender needs somewhere
-- to put the first message, and the RPC is what keeps that atomic and
-- idempotent. What was missing was the difference between a room and a room
-- nothing has ever been said in.
--
-- ## What changes
--
-- `conversation_previews()` now reports `has_messages`: whether any message
-- row has ever existed in the thread. It reads `messages` directly rather than
-- the visible window, deliberately:
--
--   - A *cleared* chat has rows behind `cleared_at`, so it stays `true` - and
--     clearing has always kept the chat listed. This change must not un-list
--     somebody's deliberate empty chat.
--   - Deleted messages are tombstones (`deleted_at`), never removed rows, so
--     `true` survives everything short of the conversation itself going.
--
-- `false` therefore means exactly one thing: this thread has never carried a
-- message from anybody. The client hides those from the list - direct threads
-- only; groups and communities announce themselves the moment you are in them,
-- which is their own long-standing behaviour - while `getConversation` still
-- resolves one by id, because opening the thread to write the first message
-- is how it stops being empty.
--
-- ## The ones already sitting there
--
-- Rules do not reach backwards on their own. The delete below removes the
-- direct conversations that exist today with no messages in them - the ghosts
-- this rule exists to prevent - along with their membership rows, which the
-- foreign key cascades. Nothing else references them: every other table hangs
-- off `messages`, and an empty thread has none.

drop function if exists public.conversation_previews();

create function public.conversation_previews()
returns table (
  conversation_id uuid,
  last_message_id uuid,
  unread_count integer,
  archived_at timestamptz,
  deleted boolean,
  muted boolean,
  muted_until timestamptz,
  has_messages boolean
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
      m.deleted_at,
      m.muted_until
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
    mine.archived_at,
    (
      mine.deleted_at is not null
      and (newest.created_at is null or newest.created_at <= mine.deleted_at)
    ) as deleted,
    -- Computed, so an expired mute is unmuted the instant it expires.
    (mine.muted_until is not null and mine.muted_until > now()) as muted,
    mine.muted_until,
    -- Over the whole table, not the visible window: a cleared chat was real,
    -- and stays listed. Only a thread that never carried a message is false.
    exists (
      select 1 from public.messages ever
      where ever.conversation_id = mine.conversation_id
    ) as has_messages
  from mine
  left join newest on newest.conversation_id = mine.conversation_id
  left join unread on unread.conversation_id = mine.conversation_id;
$$;

revoke all on function public.conversation_previews() from public;
grant execute on function public.conversation_previews() to authenticated;

delete from public.conversations c
where c.kind = 'direct'
  and not exists (
    select 1 from public.messages m where m.conversation_id = c.id
  );
