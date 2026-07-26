-- Follows, and the mutual-follow gate.
--
-- PINGO's rule: anyone can message anyone, but calls, snaps and stories need
-- both people to have accepted each other. Messaging stays open because a
-- request you cannot send is a product nobody can start using; everything with
-- a camera or a microphone in it waits for consent from both sides.
--
-- ## Why one row, not two
--
-- A follow is directional and has a state, so `(follower, followee, status)` is
-- the whole truth. "Mutual" is then two accepted rows pointing opposite ways —
-- derived, never stored. Storing a `mutual` flag as well would create a second
-- source of truth that can disagree with the rows it summarises, and it always
-- eventually does.
--
-- ## Why `pending` rather than a separate requests table
--
-- A request *is* a follow that has not been accepted. Splitting them means
-- moving a row between tables on accept, and every query that asks "is there
-- anything between these two people" has to look in both places.

create table if not exists public.follows (
  follower_id uuid not null references auth.users(id) on delete cascade,
  followee_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  primary key (follower_id, followee_id),
  -- Following yourself would make every gate below trivially true for one row.
  constraint follows_not_self check (follower_id <> followee_id)
);

create index if not exists follows_followee_pending_idx
  on public.follows (followee_id, status);

alter table public.follows enable row level security;

-- Both sides can see the row: the sender needs to know it is pending, and the
-- receiver needs to know it exists at all.
drop policy if exists "see follows involving me" on public.follows;
create policy "see follows involving me"
  on public.follows for select to authenticated
  using (follower_id = auth.uid() or followee_id = auth.uid());

-- You may only ever create your *own* outgoing request, and never pre-accepted.
drop policy if exists "send my own follow request" on public.follows;
create policy "send my own follow request"
  on public.follows for insert to authenticated
  with check (follower_id = auth.uid() and status = 'pending');

-- Only the person being followed can accept. Without the `followee_id` check a
-- sender could update their own row to `accepted` and let themselves in.
drop policy if exists "respond to requests sent to me" on public.follows;
create policy "respond to requests sent to me"
  on public.follows for update to authenticated
  using (followee_id = auth.uid())
  with check (followee_id = auth.uid());

-- Unfollow, or withdraw a request, or remove a follower.
drop policy if exists "remove follows involving me" on public.follows;
create policy "remove follows involving me"
  on public.follows for delete to authenticated
  using (follower_id = auth.uid() or followee_id = auth.uid());

-- ---------------------------------------------------------------------------
-- The gate
-- ---------------------------------------------------------------------------

/*
 * True when both people have accepted each other.
 *
 * `security definer` because the caller is checking a relationship they are
 * half of, and RLS on `follows` would otherwise hide the other person's row
 * from the very query that needs to see it. It takes no user id — it can only
 * ever answer about `auth.uid()`, so it cannot be used to probe other people's
 * relationships.
 */
create or replace function public.is_mutual(other uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.follows a
    join public.follows b
      on b.follower_id = a.followee_id and b.followee_id = a.follower_id
    where a.follower_id = auth.uid()
      and a.followee_id = other
      and a.status = 'accepted'
      and b.status = 'accepted'
  );
$$;

revoke all on function public.is_mutual(uuid) from public;
grant execute on function public.is_mutual(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Stories become mutual-only
-- ---------------------------------------------------------------------------

-- Every signed-in user could read every live story, which is why everyone's
-- circles appeared in everyone's rail. Your own always stays visible, or
-- posting one would look like it failed.
drop policy if exists "live stories are readable" on public.stories;
create policy "live stories are readable"
  on public.stories for select to authenticated
  using (
    expires_at > now()
    and (author_id = auth.uid() or public.is_mutual(author_id))
  );
