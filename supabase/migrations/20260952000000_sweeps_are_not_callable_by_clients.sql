/*
 * Two maintenance functions anybody could run, since the day they were written.
 *
 * ## The revoke that never revoked anything
 *
 * `device_key_sweep_enforces_limit` and `prune_message_notifications` each end
 * the same way:
 *
 *     revoke all on function public.prune_stale_device_keys() from anon, authenticated;
 *
 * That reads as closing the door. It does not. A function's default ACL grants
 * EXECUTE to PUBLIC, and `anon` and `authenticated` are members of PUBLIC - so
 * revoking from the two roles by name leaves the grant they actually inherit
 * completely untouched. The ACL kept saying `=X/postgres`, which *is* PUBLIC,
 * sitting there beside the revoke that was meant to remove it.
 *
 * Nothing announced it. `\df+` shows the revokes, the linter does not flag it,
 * and both functions carried on working - for cron, and for anybody with the
 * publishable key and a REST client.
 *
 * ## How bad
 *
 * Not very, which is why it survived. `prune_stale_device_keys` removes device
 * keys that are already past the eight-per-account limit or forty-five days
 * cold; `prune_message_notifications` removes read message notifications. Cron
 * does both nightly anyway, so the worst an attacker gets is tomorrow's
 * housekeeping today.
 *
 * But they are `security definer` functions that delete rows, callable over the
 * REST API by somebody who is not signed in, and the author wrote down twice
 * that this was not the intention.
 *
 * ## Found by comparing two databases rather than by reading one
 *
 * The migration to a new project compared every function's ACL between the old
 * project and the new one. These two were the only pair where the difference
 * was not a mistake in the copy: on the source the ACL is explicit and includes
 * PUBLIC, on the target it was the plain default - which grants PUBLIC as well.
 * Identical behaviour, different bytes, and the only reason to look closely
 * enough to notice.
 *
 * The revoke here names PUBLIC, which is the one that was meant. `postgres` and
 * `service_role` are re-granted explicitly. The cron jobs run as `postgres`, so
 * the sweeps are unaffected - verified by calling both after the revoke rather
 * than assuming it.
 */

revoke all on function public.prune_stale_device_keys() from public, anon, authenticated;
revoke all on function public.prune_message_notifications() from public, anon, authenticated;

grant execute on function public.prune_stale_device_keys() to postgres, service_role;
grant execute on function public.prune_message_notifications() to postgres, service_role;

comment on function public.prune_stale_device_keys() is
  'Nightly device-key sweep. Not callable by clients: the revoke names PUBLIC, because anon and authenticated inherit from it and revoking the two by name does nothing.';

comment on function public.prune_message_notifications() is
  'Nightly notification sweep. Not callable by clients, for the same reason as prune_stale_device_keys.';
