-- Replies, and letting a deleted message actually be deleted.
--
-- ## `reply_to_id`
--
-- A reply points at the message it answers. Nullable, and `on delete set null`
-- rather than cascade: deleting the original must never take the reply with it,
-- because the reply is somebody else's message and its text usually still makes
-- sense on its own. The quote just stops resolving.
--
-- The reference is not constrained to the same conversation. Doing that needs a
-- composite foreign key and a redundant column on every row, and the client only
-- ever offers Reply from inside the thread it is reading — so the constraint
-- would be paying schema weight to prevent something no caller can express.
--
-- ## Why the body check has to change
--
-- `delete_message(for_everyone => true)` sets `body = ''`, and the original
-- check demanded at least one character. So delete-for-everyone has been
-- raising a constraint violation the whole time it has existed — the tombstone
-- could never be written. Empty is now legal; the ceiling stays.

alter table public.messages
  add column if not exists reply_to_id uuid
    references public.messages (id) on delete set null;

-- Only replies are looked up this way, and most messages are not replies.
create index if not exists messages_reply_to_idx
  on public.messages (reply_to_id)
  where reply_to_id is not null;

alter table public.messages
  drop constraint if exists messages_body_length;

alter table public.messages
  add constraint messages_body_length check (char_length(body) <= 4000);
