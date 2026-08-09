-- One-sided friend request: send → accept → friends.
--
-- Until now friendship meant *two* accepted follows (A→B and B→A). Accepting
-- only flipped the incoming row, so the accepter still had to "Add back". The
-- product says Friends, not Follow — one person asks, the other accepts, and
-- both sides become friends in that tap.
--
-- Implementation: `accept_friend_request` marks the incoming request accepted
-- and upserts the reverse row as accepted. Existing `is_mutual` / `are_friends`
-- gates keep working without every call site changing.

create or replace function public.accept_friend_request(from_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  accepted_count int;
begin
  if me is null then
    raise exception 'not authenticated';
  end if;
  if from_user is null or from_user = me then
    raise exception 'invalid user';
  end if;

  -- Their request to me becomes accepted (no-op if already accepted).
  update public.follows
  set
    status = 'accepted',
    responded_at = coalesce(responded_at, now())
  where follower_id = from_user
    and followee_id = me
    and status in ('pending', 'accepted');

  get diagnostics accepted_count = row_count;
  if accepted_count = 0 then
    raise exception 'no friend request from that person';
  end if;

  -- My side of the friendship, without a second request.
  --
  -- Insert-as-accepted bypasses the client insert policy (pending only); this
  -- function is security definer so it can write both directions honestly.
  insert into public.follows (follower_id, followee_id, status, created_at, responded_at)
  values (me, from_user, 'accepted', now(), now())
  on conflict (follower_id, followee_id) do update
    set
      status = 'accepted',
      responded_at = coalesce(public.follows.responded_at, excluded.responded_at);
end;
$$;

revoke all on function public.accept_friend_request(uuid) from public;
grant execute on function public.accept_friend_request(uuid) to authenticated;

comment on function public.accept_friend_request(uuid) is
  'Accept an incoming friend request and create the reverse accepted follow so both people are friends immediately.';

/*
 * Optional heal for one-way accepted rows left by the old "Accept ≠ Add back"
 * flow: if A→B is accepted and B→A is missing, create B→A accepted so gates
 * and friend lists match what people already thought they had.
 *
 * Only when exactly one direction is accepted (not when one is still pending).
 */
insert into public.follows (follower_id, followee_id, status, created_at, responded_at)
select
  f.followee_id,
  f.follower_id,
  'accepted',
  now(),
  now()
from public.follows f
where f.status = 'accepted'
  and not exists (
    select 1
    from public.follows r
    where r.follower_id = f.followee_id
      and r.followee_id = f.follower_id
  )
on conflict (follower_id, followee_id) do update
  set
    status = 'accepted',
    responded_at = coalesce(public.follows.responded_at, excluded.responded_at);
