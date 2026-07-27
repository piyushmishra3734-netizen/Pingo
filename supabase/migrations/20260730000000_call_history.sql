-- Call history, as messages.
--
-- ## Why not a `calls` table
--
-- A finished call has to appear in two places: in the conversation, where
-- "Missed voice call" sits in the thread at the moment it happened, and in the
-- Calls screen as a list. A separate table would mean maintaining both — a row
-- *and* a message per call, two writes that can disagree, and a thread that has
-- to interleave two sources by timestamp when it renders.
--
-- A call already is what a message is: something that happened in a
-- conversation, at a time, by someone. So it is stored as one, with `kind =
-- 'call'`, and the Calls screen is a query over those rather than a table of its
-- own. One write, one ordering, and the thread needs no special case.
--
-- ## Shape of `meta`
--
--   { callKind: 'voice' | 'video',
--     outcome: 'answered' | 'missed' | 'declined' | 'unreachable',
--     durationSeconds: number,
--     calleeId: uuid }
--
-- `calleeId` is stored because the sender is the caller, and direction is
-- otherwise unrecoverable for anyone but the two participants — a group call
-- log would be unreadable without it.
--
-- ## Missed calls do not count as unread
--
-- `conversation_previews` counts other people's messages after your read
-- cursor. A missed call is exactly that, so it would bold the row — which is
-- arguably right, and is why this is left alone rather than special-cased.

alter table public.messages
  drop constraint if exists messages_kind_check;

alter table public.messages
  add constraint messages_kind_check
    check (
      kind in (
        'text', 'sticker', 'snap', 'photo', 'voice',
        'document', 'location', 'contact', 'event', 'call'
      )
    );

-- The Calls screen reads every call across every conversation, newest first.
create index if not exists messages_calls_idx
  on public.messages (created_at desc)
  where kind = 'call';
