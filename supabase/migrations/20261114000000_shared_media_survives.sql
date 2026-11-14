-- One file, several messages: the bytes outlive the first of them.
--
-- A photo shared to four chats used to be four uploads. Sending it once and letting the four messages name the same
-- object (as WhatsApp does when one file goes to many chats) needs one more rule here, because the collector decides
-- per MESSAGE: when the first of the four is parked (delivered everywhere plus the minimum retention, deleted for
-- everyone, past its lifetime) the uploader's client would remove the object, and the other three would point at
-- nothing.
--
-- `pending_media_purges()` is the one list the uploader's client deletes from, old installs included, so the rule lives
-- there: a parked message's object is only handed out for deletion when no OTHER message that is still live (not
-- parked, not purged) names the same file. Until then the parked message simply waits in the list's shadow; when the
-- last one is parked too, they all appear and are removed (a second removal of an object already gone is a success on
-- the client, see media-reaper.ts).
--
-- What does not change: who may read the file (`visible_chat_media` already asks "is there ANY message in a
-- conversation I am in that names it"), the retention numbers, the per-message hard ceiling (each message stamps its own
-- `media_expires_at` on insert), `confirm_media_purged` (it clears only the message it is given), and the abandoned
-- upload list (it already treats a file any message names as used).
--
-- Fails in the safe direction: a mistake here leaves bytes in storage a little longer; it can never remove something
-- a live message still shows.

create or replace function public.pending_media_purges()
returns table (message_id uuid, path text, bucket text)
language sql
security definer
set search_path = public
stable
as $$
  select m.id, m.media_purge_path, m.media_purge_bucket
  from public.messages m
  where m.sender_id = auth.uid()
    and m.media_purge_path is not null
    and m.media_purged_at is null
    -- Another live message still names this very file: it keeps it.
    and not exists (
      select 1
      from public.messages o
      where o.id <> m.id
        and o.media_purge_path is null
        and o.media_purged_at is null
        and (
          o.photo_path = m.media_purge_path
          or o.file_path = m.media_purge_path
          or o.voice_path = m.media_purge_path
        )
    )
  limit 200;
$$;
