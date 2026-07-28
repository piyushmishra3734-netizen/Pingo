-- Any member could promote themselves to admin.
--
-- The groups migration tried to close this with
-- `revoke update (role) on conversation_members from authenticated`, and that
-- does nothing. In PostgreSQL a table-level `GRANT UPDATE` is a single
-- privilege covering every column; a column-level `REVOKE` cannot carve an
-- exception out of it. Supabase grants table-level UPDATE to `authenticated` by
-- default, so the revoke was a no-op against a grant that was still there, and
-- a plain
--
--     update conversation_members set role = 'admin' where user_id = auth.uid()
--
-- succeeded — the row is your own, so the RLS policy allows it, and there was
-- nothing else in the way. Every admin-only function was reachable by anyone
-- who could send one update first.
--
-- Found by trying it as a real member rather than by reading the policy. The
-- migration that introduced it applied without complaint, and `is_admin` looked
-- correct in isolation; the hole was the shape of the grant underneath, which
-- no amount of reading the policy would have shown.
--
-- The fix is the only order that works: drop the table-wide privilege, then
-- grant back exactly the columns a member is allowed to set about themselves.
-- `role` is not among them, so the sole remaining route is `set_group_admin`,
-- which runs as definer and checks for an admin first.

revoke update on public.conversation_members from authenticated, anon;

/*
 * Personal state, and nothing else.
 *
 * These are the columns that answer "how do *I* keep this chat" — where it
 * sits, whether it makes a sound, how far I have read, whether I have filed it
 * away. Every one of them is scoped to the caller's own row by the existing
 * policy, and none of them means anything to anybody else in the conversation.
 *
 * Left out deliberately: `conversation_id`, `user_id` and `joined_at`, which
 * identify the membership rather than describe it — a client that could rewrite
 * those could move its own membership into somebody else's conversation.
 */
grant update (
  last_read_at,
  pinned,
  favorite,
  archived_at,
  marked_unread,
  cleared_at,
  deleted_at,
  muted_until
) on public.conversation_members to authenticated;
