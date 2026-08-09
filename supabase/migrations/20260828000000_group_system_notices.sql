-- Group membership notices in the thread.
--
-- Without these, a group is a pile of bubbles with no record of who joined,
-- who was added, or who left. Notices are plaintext `kind = 'system'` rows
-- (no E2EE envelope); the client maps them to centred captions via `Message.system`.

alter table public.messages drop constraint if exists messages_kind_check;

alter table public.messages
  add constraint messages_kind_check
    check (
      kind in (
        'text', 'sticker', 'snap', 'photo', 'voice',
        'document', 'location', 'contact', 'event', 'call',
        'system'
      )
    );

create or replace function public.profile_label(uid uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    nullif(btrim(p.display_name), ''),
    nullif(btrim(p.username), ''),
    'Someone'
  )
  from public.profiles p
  where p.id = uid;
$$;

revoke all on function public.profile_label(uuid) from public;

create or replace function public.post_group_system_notice(
  conv uuid,
  actor uuid,
  body text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if body is null or btrim(body) = '' then
    return;
  end if;

  insert into public.messages (
    conversation_id,
    sender_id,
    body,
    kind,
    encryption,
    envelope
  )
  values (
    conv,
    actor,
    left(btrim(body), 4000),
    'system',
    null,
    null
  );

  update public.conversations
  set last_message_at = now()
  where id = conv;
end;
$$;

revoke all on function public.post_group_system_notice(uuid, uuid, text) from public;

-- ---------------------------------------------------------------------------
-- Wire notices into existing roster mutations
-- ---------------------------------------------------------------------------

create or replace function public.add_group_members(conv uuid, member_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  candidate uuid;
  actor_name text;
  member_name text;
  inserted int;
begin
  if not public.is_conversation_admin(conv) then
    raise exception 'only an admin can add people' using errcode = 'GR003';
  end if;

  foreach candidate in array coalesce(member_ids, '{}') loop
    if not public.is_mutual(candidate) then
      raise exception 'you can only add friends to a group' using errcode = 'GR002';
    end if;
  end loop;

  actor_name := public.profile_label(me);

  foreach candidate in array coalesce(member_ids, '{}') loop
    insert into public.conversation_members (conversation_id, user_id, role)
    values (conv, candidate, 'member')
    on conflict do nothing;

    get diagnostics inserted = row_count;
    if inserted > 0 then
      member_name := public.profile_label(candidate);
      perform public.post_group_system_notice(
        conv,
        me,
        actor_name || ' added ' || member_name
      );
    end if;
  end loop;
end;
$$;

create or replace function public.remove_group_member(conv uuid, target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  actor_name text;
  member_name text;
  removed int;
begin
  if not public.is_conversation_admin(conv) then
    raise exception 'only an admin can remove people' using errcode = 'GR003';
  end if;

  if target = me then
    raise exception 'use leave_group to leave' using errcode = 'GR004';
  end if;

  actor_name := public.profile_label(me);
  member_name := public.profile_label(target);

  delete from public.conversation_members
  where conversation_id = conv and user_id = target;

  get diagnostics removed = row_count;
  if removed > 0 then
    perform public.post_group_system_notice(
      conv,
      me,
      actor_name || ' removed ' || member_name
    );
  end if;
end;
$$;

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
  leaver_name text;
begin
  select (m.role = 'admin') into was_admin
  from public.conversation_members m
  where m.conversation_id = conv and m.user_id = me;

  if was_admin is null then
    return;
  end if;

  leaver_name := public.profile_label(me);

  delete from public.conversation_members
  where conversation_id = conv and user_id = me;

  -- Notice after delete so the leaver is still a valid sender_id historically.
  perform public.post_group_system_notice(
    conv,
    me,
    leaver_name || ' left'
  );

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

    perform public.post_group_system_notice(
      conv,
      heir,
      public.profile_label(heir) || ' is now an admin'
    );
  end if;
end;
$$;

-- Join via invite link (body of original function preserved + notice).
create or replace function public.join_group_with_code(invite_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  conv uuid;
  joiner_name text;
begin
  if me is null then
    raise exception 'not authenticated';
  end if;

  select i.conversation_id into conv
  from public.conversation_invites i
  join public.conversations c on c.id = i.conversation_id
  where i.code = invite_code
    and i.revoked_at is null
    and c.kind in ('group', 'community');

  if conv is null then
    raise exception 'that invite is no longer valid' using errcode = 'GR006';
  end if;

  insert into public.conversation_members (conversation_id, user_id, role)
  values (conv, me, 'member')
  on conflict do nothing;

  joiner_name := public.profile_label(me);
  perform public.post_group_system_notice(
    conv,
    me,
    joiner_name || ' joined'
  );

  return conv;
end;
$$;
