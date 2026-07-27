-- Mute for a while, and let archiving answer to a preference.
--
-- ## Mute becomes a deadline, not a flag
--
-- "Muted" is almost never meant forever — it is "not for the next few hours".
-- A boolean cannot say that, so every product with a boolean grows a second
-- column beside it anyway. `muted_until` is the whole state: null is unmuted,
-- a timestamp is muted until then, and `infinity` is muted for good.
--
-- Whether a chat is muted *right now* is therefore computed rather than stored,
-- which means an expired mute needs no job to come along and clear it. There is
-- no moment where the database says muted and the truth is otherwise.
--
-- The old `muted` boolean is dropped rather than kept in step. Two columns
-- describing one fact is how they end up disagreeing, and the only writer was
-- the client code changed alongside this.
--
-- ## Archiving reports its timestamp, and the client decides
--
-- Some people want an archived chat to stay archived when a new message lands;
-- some want it back in the list. Enforcing either with a write is fragile —
-- auto-unarchiving needs something running at the moment the message arrives,
-- so closing the app would produce a different answer from leaving it open.
--
-- Returning `archived_at` and letting the reader compare it against the newest
-- message makes both behaviours pure functions of state. Nothing to schedule,
-- nothing to reconcile, and switching the preference re-sorts the existing list
-- correctly rather than only applying to whatever happens next.

alter table public.conversation_members
  add column if not exists muted_until timestamptz;

-- Existing mutes were unconditional, so they carry over as exactly that.
update public.conversation_members
   set muted_until = 'infinity'
 where muted is true and muted_until is null;

alter table public.conversation_members drop column if exists muted;

drop function if exists public.conversation_previews();

create function public.conversation_previews()
returns table (
  conversation_id uuid,
  last_message_id uuid,
  unread_count integer,
  archived_at timestamptz,
  deleted boolean,
  muted boolean,
  muted_until timestamptz
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
    mine.muted_until
  from mine
  left join newest on newest.conversation_id = mine.conversation_id
  left join unread on unread.conversation_id = mine.conversation_id;
$$;

revoke all on function public.conversation_previews() from public;
grant execute on function public.conversation_previews() to authenticated;
