-- Internal functions and a view, closed to the API.
--
-- Found auditing everything that touches `messages` before normal chats stop
-- being end-to-end encrypted (the normal/private split, phase 1). None of these
-- leaked a message body, but each was callable - or readable - with nothing but
-- the public anon key, because Postgres grants EXECUTE to PUBLIC by default and
-- a view runs as its owner:
--
--   post_group_system_notice(conv, actor, body)
--       wrote a "system" message into ANY conversation, as anyone.
--   destroy_snap(snap_id)          destroyed anybody's Ping by id.
--   push_allowed(target, kind)     told anyone whether a user is on DND,
--                                  muted, or in quiet hours.
--   expire_messages(), purge_delivered_media()
--                                  cron sweeps, runnable by anybody.
--   media_fully_delivered (view)   who sent media in which conversation, and
--                                  the storage paths.
--
-- Every legitimate caller is a SECURITY DEFINER function, a trigger or cron -
-- all run as the owner - or the service role, so nothing in the app changes.
-- Checked before applying: no SECURITY INVOKER function, policy or view uses
-- any of them. The one the app does call, `purge_expired_snaps` (a sweep with
-- no arguments), stays open to signed-in users.
--
-- Applied to gpijpmepzowwhvgkriqu through the Supabase MCP as
-- `close_internal_functions_to_api`.

revoke execute on function public.post_group_system_notice(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.destroy_snap(uuid) from public, anon, authenticated;
revoke execute on function public.expire_messages() from public, anon, authenticated;
revoke execute on function public.purge_delivered_media() from public, anon, authenticated;
revoke execute on function public.push_allowed(uuid, text) from public, anon, authenticated;
revoke execute on function public.purge_expired_snaps() from public, anon;
grant execute on function public.purge_expired_snaps() to authenticated;

grant execute on function
  public.post_group_system_notice(uuid, uuid, text),
  public.destroy_snap(uuid),
  public.expire_messages(),
  public.purge_delivered_media(),
  public.push_allowed(uuid, text),
  public.purge_expired_snaps()
to service_role;

revoke select on public.media_fully_delivered from anon, authenticated;
grant select on public.media_fully_delivered to service_role;
