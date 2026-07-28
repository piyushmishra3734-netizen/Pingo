-- PINGO — the rest of the app, live.
--
-- Four tables were published: `messages`, `conversation_members`,
-- `message_reactions` and `notifications`. Everything else in the product
-- reached the screen only when something happened to fetch it again, so the
-- app had one live surface — a chat thread — and a dozen dead ones. Being added
-- to a group, somebody joining one, a story going up, a post appearing, a bio
-- changing, a follow request arriving: all of it waited for a refresh.
--
-- ## What "live" costs, and why it is worth it here
--
-- Realtime applies each table's own RLS to its stream, so publishing a table
-- reveals nothing a client could not already read. It does mean the server
-- sends a row to every client entitled to see it: `profiles` is readable by
-- everyone, so every profile edit reaches every open session.
--
-- That is fine at this size and would not be at a large one. The shape of the
-- fix later is a filtered subscription per client rather than an unpublished
-- table, so nothing here has to be undone — the client already ignores rows it
-- has no use for.
--
-- ## `conversations` is published now, and the comment saying not to was right
-- ## at the time
--
-- The first migration deliberately left it out: the list updated from the same
-- message events, so publishing both would deliver every change twice. That
-- held while a conversation only ever changed *because* of a message. Groups
-- broke it — a rename, a new picture, a member joining are all changes with no
-- message attached, and the list had no way to hear about any of them.
--
-- The double delivery is handled where it belongs, in the client: both paths
-- re-read the conversation and emit the same value, and the provider replaces
-- by id.

do $$
declare
  t text;
begin
  foreach t in array array[
    -- Renames, new group pictures, and a group appearing at all.
    'conversations',
    -- Somebody's story going up or coming down, without a reload of the rail.
    'stories',
    -- The three-post shelf, live on whoever is looking at it.
    'posts',
    -- Display name, bio, avatar — the things that are wrong everywhere at once
    -- until the page is reloaded.
    'profiles',
    -- Follow requests arriving, and being accepted.
    'follows'
  ] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      -- Already published, or the table does not exist in this environment.
      when duplicate_object then null;
      when undefined_table then null;
    end;
  end loop;
end;
$$;
