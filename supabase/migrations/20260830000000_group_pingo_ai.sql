-- PINGO AI in groups: membership + replies on @mention.
--
-- The 1:1 AI thread stays kind = 'ai'. In groups the bot is a normal member
-- (fixed user id from pingo_ai_user_id). post_ai_reply may insert as the bot
-- when the bot is already in that group and the caller is a member.

-- ---------------------------------------------------------------------------
-- Add members: AI bot does not need mutual-follow
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
  bot uuid := public.pingo_ai_user_id();
begin
  if not public.is_conversation_admin(conv) then
    raise exception 'only an admin can add people' using errcode = 'GR003';
  end if;

  foreach candidate in array coalesce(member_ids, '{}') loop
    if candidate = bot then
      continue; -- allowed without mutual
    end if;
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
      if member_name is null or member_name = 'Someone' then
        if candidate = bot then
          member_name := 'PINGO AI';
        end if;
      end if;
      if candidate = bot then
        member_name := 'PINGO AI';
      end if;
      perform public.post_group_system_notice(
        conv,
        me,
        actor_name || ' added ' || member_name
      );
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Convenience: add the bot in one call
-- ---------------------------------------------------------------------------

create or replace function public.add_pingo_ai_to_group(conv uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  bot uuid := public.pingo_ai_user_id();
begin
  if me is null then
    raise exception 'not authenticated';
  end if;

  if not public.is_conversation_admin(conv) then
    raise exception 'only an admin can add people' using errcode = 'GR003';
  end if;

  if not exists (
    select 1 from public.conversations c
    where c.id = conv and c.kind in ('group', 'community')
  ) then
    raise exception 'not a group' using errcode = 'GR001';
  end if;

  -- Ensure bot profile exists for display.
  insert into public.profiles (id, username, display_name, bio)
  values (bot, 'pingo_ai', 'PINGO AI', 'Your AI in PINGO. Mention @pingoai in groups.')
  on conflict (id) do update
    set display_name = coalesce(nullif(btrim(public.profiles.display_name), ''), 'PINGO AI'),
        username = coalesce(public.profiles.username, 'pingo_ai');

  perform public.add_group_members(conv, array[bot]);
end;
$$;

revoke all on function public.add_pingo_ai_to_group(uuid) from public;
grant execute on function public.add_pingo_ai_to_group(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- post_ai_reply: 1:1 AI thread OR group that already includes the bot
-- ---------------------------------------------------------------------------

create or replace function public.post_ai_reply(
  target_conversation uuid,
  reply_body text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  bot uuid := public.pingo_ai_user_id();
  msg_id uuid;
  k text;
  bot_in boolean;
begin
  if me is null then
    raise exception 'Sign in required.';
  end if;

  if reply_body is null or char_length(trim(reply_body)) = 0 then
    raise exception 'Empty reply.';
  end if;

  -- Caller must be a member.
  select c.kind into k
  from public.conversations c
  join public.conversation_members m on m.conversation_id = c.id
  where c.id = target_conversation
    and m.user_id = me
    and m.deleted_at is null;

  if k is null then
    raise exception 'Not a member of this conversation.';
  end if;

  if k = 'ai' then
    null; -- classic DM path
  elsif k in ('group', 'community') then
    select exists (
      select 1
      from public.conversation_members m
      where m.conversation_id = target_conversation
        and m.user_id = bot
        and m.deleted_at is null
    ) into bot_in;

    if not bot_in then
      raise exception 'PINGO AI is not in this group.';
    end if;
  else
    raise exception 'Not an AI conversation.';
  end if;

  insert into public.messages (conversation_id, sender_id, body, kind, encryption, envelope)
  values (
    target_conversation,
    bot,
    left(trim(reply_body), 4000),
    'text',
    null,
    null
  )
  returning id into msg_id;

  update public.conversations
  set last_message_at = now()
  where id = target_conversation;

  insert into public.ai_processing_log (user_id, conversation_id, role, body)
  values (me, target_conversation, 'assistant', left(trim(reply_body), 4000));

  return msg_id;
end;
$$;

revoke all on function public.post_ai_reply(uuid, text) from public;
grant execute on function public.post_ai_reply(uuid, text) to authenticated;

-- Bot display handle for @mentions
update public.profiles
set
  username = coalesce(username, 'pingo_ai'),
  display_name = case
    when display_name is null or btrim(display_name) = '' or display_name = 'PINGO'
      then 'PINGO AI'
    else display_name
  end
where id = public.pingo_ai_user_id();

-- Log user turns for group @mentions too (processing copy, 24h retention).
create or replace function public.log_ai_user_turn(
  target_conversation uuid,
  turn_body text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  k text;
  bot uuid := public.pingo_ai_user_id();
  bot_in boolean := false;
begin
  if me is null then return; end if;

  select c.kind into k
  from public.conversations c
  join public.conversation_members m on m.conversation_id = c.id
  where c.id = target_conversation and m.user_id = me;

  if k is null then return; end if;

  if k = 'ai' then
    null;
  elsif k in ('group', 'community') then
    select exists (
      select 1 from public.conversation_members m
      where m.conversation_id = target_conversation
        and m.user_id = bot
        and m.deleted_at is null
    ) into bot_in;
    if not bot_in then return; end if;
  else
    return;
  end if;

  insert into public.ai_processing_log (user_id, conversation_id, role, body)
  values (me, target_conversation, 'user', left(coalesce(turn_body, ''), 4000));
end;
$$;
