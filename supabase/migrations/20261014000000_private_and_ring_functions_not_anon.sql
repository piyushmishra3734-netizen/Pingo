-- The functions from 20261010000000 and 20261012000000, closed to anon.
--
-- A new function is executable by PUBLIC, which includes anon. These are all
-- security definer: `may_see_posts(viewer, subject)` would tell a signed-out
-- caller who follows a private account, and `call_rings` gets anon's default
-- table grant. Applied live on 2026-09-28 alongside the two migrations.

revoke execute on function public.is_private_account(uuid) from public, anon;
revoke execute on function public.may_see_posts(uuid, uuid) from public, anon;
grant execute on function public.is_private_account(uuid) to authenticated;
grant execute on function public.may_see_posts(uuid, uuid) to authenticated;

revoke all on public.call_rings from anon;

revoke execute on function public.ring_call(uuid, uuid, uuid, text) from public, anon;
revoke execute on function public.end_call_ring(uuid) from public, anon;
grant execute on function public.ring_call(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.end_call_ring(uuid) to authenticated;
