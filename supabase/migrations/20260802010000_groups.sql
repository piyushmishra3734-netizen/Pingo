-- PINGO — groups.
--
-- `conversations.kind` has allowed `'group'` since the first migration and
-- nothing has ever been able to create one. This is the rest of it: a roster
-- with roles, the two ways in, and the rules about who may do what.
--
-- ## The two doors, and why there are two
--
-- Adding somebody straight into a group reaches into their app without asking.
-- That is fine between friends and is not fine from a stranger, so **being
-- added requires a mutual follow** — the same test stories already use. Nobody
-- can be pulled into a room by someone they have not agreed to hear from.
--
-- The cost of that rule is real: half the reason groups exist is the people you
-- have not met yet. So the second door is an **invite link**, which an admin
-- creates deliberately and can revoke. Following a link is the invitee's own
-- act, so no friendship is needed — the consent that the mutual-follow test was
-- standing in for has been given directly.
--
-- One rule, stated once: *you may be put in a group by a friend, or you may
-- walk in yourself.* Nothing else gets you in.
--
-- ## Why every write is a function
--
-- Promotion, removal, renaming and joining all have conditions attached, and a
-- condition expressed as an RLS policy on `conversation_members` would have to
-- read `conversation_members` to check it — which is the recursion the very
-- first migration hit and solved with `is_conversation_member`. Rather than
-- grow a second family of definer predicates, the mutations go through definer
-- functions and the table stays readable-but-not-writable from the client.

-- ---------------------------------------------------------------------------
-- Roles, and a picture for the group
-- ---------------------------------------------------------------------------

alter table public.conversation_members
  add column if not exists role text not null default 'member';

do $$
begin
  alter table public.conversation_members
    add constraint conversation_members_role check (role in ('member', 'admin'));
exception
  when duplicate_object then null;
end;
$$;

-- Groups get their own picture. A direct chat's avatar is still whoever else is
-- in it, resolved per viewer, so this stays null there.
alter table public.conversations
  add column if not exists avatar_url text;

-- ---------------------------------------------------------------------------
-- Invite links
-- ---------------------------------------------------------------------------
--
-- One live code per group at a time. Revoking is what makes a link a link
-- rather than a permanent back door: a code that leaked somewhere public has to
-- be killable without dissolving the group.

create table if not exists public.conversation_invites (
  code text primary key,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists conversation_invites_conversation_idx
  on public.conversation_invites (conversation_id)
  where revoked_at is null;

alter table public.conversation_invites enable row level security;

-- Members may see their own group's code, so an admin can show it and any
-- member can tell whether one is live. Nobody may read it by conversation they
-- are not in, and *nobody* may select by code — that would turn the table into
-- a directory of every group on PINGO. Redeeming happens inside a definer
-- function, which is the only thing that ever looks a code up.
drop policy if exists "members read their invite" on public.conversation_invites;
create policy "members read their invite"
  on public.conversation_invites for select
  to authenticated
  using (public.is_conversation_member(conversation_id));

-- ---------------------------------------------------------------------------
-- Predicates
-- ---------------------------------------------------------------------------

create or replace function public.is_conversation_admin(conv uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.conversation_members m
    where m.conversation_id = conv
      and m.user_id = auth.uid()
      and m.role = 'admin'
  );
$$;

revoke all on function public.is_conversation_admin(uuid) from public;
grant execute on function public.is_conversation_admin(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Creating a group
-- ---------------------------------------------------------------------------

create or replace function public.create_group(
  title text,
  member_ids uuid[] default '{}',
  avatar_url text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  conv uuid;
  candidate uuid;
  clean_title text := nullif(btrim(title), '');
begin
  if me is null then
    raise exception 'not authenticated';
  end if;

  if clean_title is null then
    raise exception 'a group needs a name' using errcode = 'GR001';
  end if;

  if char_length(clean_title) > 60 then
    raise exception 'that name is too long' using errcode = 'GR001';
  end if;

  /*
   * The gate, before anything is written.
   *
   * Checked up front rather than per-insert so a group is never half-created
   * with the friends in it and an error about the stranger — the caller either
   * gets the group they asked for or gets told which name to remove.
   */
  foreach candidate in array coalesce(member_ids, '{}') loop
    if candidate = me then
      continue;
    end if;
    if not public.is_mutual(candidate) then
      raise exception 'you can only add friends to a group' using errcode = 'GR002';
    end if;
  end loop;

  insert into public.conversations (kind, title, created_by, avatar_url)
  values ('group', clean_title, me, nullif(btrim(avatar_url), ''))
  returning id into conv;

  -- The creator is the first admin. A group with no admin cannot be
  -- administered back into having one.
  insert into public.conversation_members (conversation_id, user_id, role)
  values (conv, me, 'admin');

  foreach candidate in array coalesce(member_ids, '{}') loop
    if candidate = me then
      continue;
    end if;
    insert into public.conversation_members (conversation_id, user_id, role)
    values (conv, candidate, 'member')
    on conflict do nothing;
  end loop;

  return conv;
end;
$$;

revoke all on function public.create_group(text, uuid[], text) from public;
grant execute on function public.create_group(text, uuid[], text) to authenticated;

-- ---------------------------------------------------------------------------
-- The roster
-- ---------------------------------------------------------------------------

create or replace function public.add_group_members(conv uuid, member_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate uuid;
begin
  if not public.is_conversation_admin(conv) then
    raise exception 'only an admin can add people' using errcode = 'GR003';
  end if;

  -- Mutual with *the person doing the adding*, not with the group. An admin
  -- vouching for someone is what makes the add consensual; "a friend of a
  -- friend of a member" is not consent from anybody.
  foreach candidate in array coalesce(member_ids, '{}') loop
    if not public.is_mutual(candidate) then
      raise exception 'you can only add friends to a group' using errcode = 'GR002';
    end if;
  end loop;

  foreach candidate in array coalesce(member_ids, '{}') loop
    insert into public.conversation_members (conversation_id, user_id, role)
    values (conv, candidate, 'member')
    on conflict do nothing;
  end loop;
end;
$$;

revoke all on function public.add_group_members(uuid, uuid[]) from public;
grant execute on function public.add_group_members(uuid, uuid[]) to authenticated;

create or replace function public.remove_group_member(conv uuid, target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_conversation_admin(conv) then
    raise exception 'only an admin can remove people' using errcode = 'GR003';
  end if;

  -- Leaving is your own decision and has its own function, which knows how to
  -- hand the group on. Routing it through here would let an admin "remove"
  -- themselves and strand a group with nobody able to administer it.
  if target = auth.uid() then
    raise exception 'use leave_group to leave' using errcode = 'GR004';
  end if;

  delete from public.conversation_members
  where conversation_id = conv and user_id = target;
end;
$$;

revoke all on function public.remove_group_member(uuid, uuid) from public;
grant execute on function public.remove_group_member(uuid, uuid) to authenticated;

/*
 * Leaving, including the awkward case.
 *
 * The last admin walking out of a group that still has people in it would leave
 * a room nobody can rename, nobody can add to, and nobody can be removed from —
 * permanently, because promotion needs an admin. So the longest-standing
 * remaining member is promoted on the way out. Not a vote and not a prompt: the
 * person leaving has already stopped caring, and the alternative is a dead room.
 */
create or replace function public.leave_group(conv uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  was_admin boolean;
  heir uuid;
begin
  select (m.role = 'admin') into was_admin
  from public.conversation_members m
  where m.conversation_id = conv and m.user_id = me;

  if was_admin is null then
    return;
  end if;

  delete from public.conversation_members
  where conversation_id = conv and user_id = me;

  if not was_admin then
    return;
  end if;

  if exists (
    select 1 from public.conversation_members m
    where m.conversation_id = conv and m.role = 'admin'
  ) then
    return;
  end if;

  select m.user_id into heir
  from public.conversation_members m
  where m.conversation_id = conv
  order by m.joined_at
  limit 1;

  if heir is not null then
    update public.conversation_members
    set role = 'admin'
    where conversation_id = conv and user_id = heir;
  end if;
end;
$$;

revoke all on function public.leave_group(uuid) from public;
grant execute on function public.leave_group(uuid) to authenticated;

-- One call, one tap. Demotion is the same function with `false`, because
-- "make admin" and "dismiss as admin" are one decision with two directions.
create or replace function public.set_group_admin(conv uuid, target uuid, make_admin boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_conversation_admin(conv) then
    raise exception 'only an admin can change roles' using errcode = 'GR003';
  end if;

  /*
   * You cannot demote yourself if you are the only admin left.
   *
   * Same dead-room problem as `leave_group`, reached by a different door, and
   * worth blocking rather than silently promoting somebody — an admin who is
   * staying can pick their successor first.
   */
  if not make_admin and target = auth.uid() then
    if (
      select count(*) from public.conversation_members m
      where m.conversation_id = conv and m.role = 'admin'
    ) <= 1 then
      raise exception 'make someone else an admin first' using errcode = 'GR005';
    end if;
  end if;

  update public.conversation_members
  set role = case when make_admin then 'admin' else 'member' end
  where conversation_id = conv and user_id = target;
end;
$$;

revoke all on function public.set_group_admin(uuid, uuid, boolean) from public;
grant execute on function public.set_group_admin(uuid, uuid, boolean) to authenticated;

create or replace function public.update_group(conv uuid, title text, avatar_url text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_title text := nullif(btrim(title), '');
begin
  if not public.is_conversation_admin(conv) then
    raise exception 'only an admin can change the group' using errcode = 'GR003';
  end if;

  if clean_title is null or char_length(clean_title) > 60 then
    raise exception 'that name will not do' using errcode = 'GR001';
  end if;

  update public.conversations
  set title = clean_title,
      -- An empty string means "remove the picture", which is a different
      -- instruction from leaving the argument out entirely.
      avatar_url = nullif(btrim(coalesce(avatar_url, '')), '')
  where id = conv and kind = 'group';
end;
$$;

revoke all on function public.update_group(uuid, text, text) from public;
grant execute on function public.update_group(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The link
-- ---------------------------------------------------------------------------

create or replace function public.group_invite_code(conv uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  existing text;
  fresh text;
begin
  if not public.is_conversation_admin(conv) then
    raise exception 'only an admin can invite by link' using errcode = 'GR003';
  end if;

  -- Idempotent. Opening the invite screen twice must not quietly invalidate the
  -- link somebody is already holding.
  select i.code into existing
  from public.conversation_invites i
  where i.conversation_id = conv and i.revoked_at is null
  limit 1;

  if existing is not null then
    return existing;
  end if;

  /*
   * 72 bits from `gen_random_bytes`, made URL-safe.
   *
   * Not a sequence and not anything derived from the group's id: a guessable
   * code is an open door, and a code that encodes the conversation would let
   * anyone holding one link probe for others.
   */
  fresh := replace(replace(encode(gen_random_bytes(9), 'base64'), '/', '_'), '+', '-');

  insert into public.conversation_invites (code, conversation_id, created_by)
  values (fresh, conv, auth.uid());

  return fresh;
end;
$$;

revoke all on function public.group_invite_code(uuid) from public;
grant execute on function public.group_invite_code(uuid) to authenticated;

create or replace function public.revoke_group_invite(conv uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_conversation_admin(conv) then
    raise exception 'only an admin can revoke the link' using errcode = 'GR003';
  end if;

  update public.conversation_invites
  set revoked_at = now()
  where conversation_id = conv and revoked_at is null;
end;
$$;

revoke all on function public.revoke_group_invite(uuid) from public;
grant execute on function public.revoke_group_invite(uuid) to authenticated;

/*
 * Walking in.
 *
 * No friendship test, on purpose — that is the entire reason the link exists.
 * The consent the mutual-follow rule stands in for has been given directly by
 * both sides here: an admin made the link, and the person following it chose to.
 *
 * Returns the conversation either way, so a second tap on the same link opens
 * the group rather than erroring at somebody who is already in it.
 */
create or replace function public.join_group_with_code(invite_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  conv uuid;
begin
  if me is null then
    raise exception 'not authenticated';
  end if;

  select i.conversation_id into conv
  from public.conversation_invites i
  where i.code = invite_code and i.revoked_at is null;

  if conv is null then
    raise exception 'that link is no longer valid' using errcode = 'GR006';
  end if;

  insert into public.conversation_members (conversation_id, user_id, role)
  values (conv, me, 'member')
  on conflict do nothing;

  return conv;
end;
$$;

revoke all on function public.join_group_with_code(text) from public;
grant execute on function public.join_group_with_code(text) to authenticated;

/*
 * What a link shows before you commit to it.
 *
 * Deliberately thin: the name, the picture and how many people are in it. Not
 * the roster, and not a single message — someone holding a link has not joined
 * anything yet and must not be able to read the room by hovering in the doorway.
 */
create or replace function public.preview_group_invite(invite_code text)
returns table (conversation_id uuid, title text, avatar_url text, member_count integer)
language sql
security definer
set search_path = public
stable
as $$
  select c.id,
         c.title,
         c.avatar_url,
         (select count(*)::integer from public.conversation_members m where m.conversation_id = c.id)
  from public.conversation_invites i
  join public.conversations c on c.id = i.conversation_id
  where i.code = invite_code and i.revoked_at is null;
$$;

revoke all on function public.preview_group_invite(text) from public;
grant execute on function public.preview_group_invite(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Leaving one door shut
-- ---------------------------------------------------------------------------
--
-- `conversation_members` has an update policy scoped to your own row, which is
-- exactly right for pinned, muted, favourite and the read cursor — and, now
-- that `role` lives on the same row, would also let anybody promote themselves
-- to admin of any group they are in.
--
-- A column privilege rather than a cleverer policy. Expressing "role must not
-- change" in the `with check` means reading `conversation_members` from inside
-- a policy on `conversation_members`, which is the shape that has already cost
-- this schema one infinite recursion. Postgres can simply refuse the column.
--
-- `set_group_admin` runs as definer, so it is unaffected — which leaves exactly
-- one way for a role to change, and it has an admin check at the top of it.

revoke update (role) on public.conversation_members from authenticated;
revoke update (role) on public.conversation_members from anon;
