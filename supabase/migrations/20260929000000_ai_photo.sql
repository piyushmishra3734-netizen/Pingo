-- PINGO AI can send a picture, not only words.
--
-- ## One guard, two posters
--
-- `post_ai_reply` carries thirty lines deciding whether the caller may make the
-- bot speak in this conversation: a member of a 1:1 `ai` thread, or of a group
-- the bot is actually in. `post_ai_photo` needs exactly the same answer, and a
-- second copy of a security check is a second thing to forget when the rule
-- changes. So the check moves into `ai_may_post` and both call it.
--
-- ## The picture goes through the ordinary media lifecycle
--
-- Nothing special is done to keep it. The insert trigger stamps
-- `media_expires_at` like any other photo, so a generated image leaves the
-- server 24 hours after it was sent, the same as one a person sends - and the
-- recipient's own copy is what survives, which is the whole arrangement.

-- ---------------------------------------------------------------------------
-- The shared guard
-- ---------------------------------------------------------------------------

/*
 * May `auth.uid()` make the bot post into this conversation?
 *
 * Raises rather than returning false. The callers have nothing useful to do
 * with a no, and an exception is the difference between a refused post and a
 * silent one.
 */
create or replace function public.ai_may_post(target_conversation uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  bot uuid := public.pingo_ai_user_id();
  k text;
  bot_in boolean;
begin
  if me is null then
    raise exception 'Sign in required.';
  end if;

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
    return; -- classic DM path
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
end;
$$;

revoke all on function public.ai_may_post(uuid) from public;
grant execute on function public.ai_may_post(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The text poster, now using it
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
begin
  if reply_body is null or char_length(trim(reply_body)) = 0 then
    raise exception 'Empty reply.';
  end if;

  perform public.ai_may_post(target_conversation);

  insert into public.messages (conversation_id, sender_id, body, kind, encryption, envelope)
  values (target_conversation, bot, left(trim(reply_body), 4000), 'text', null, null)
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

-- ---------------------------------------------------------------------------
-- The picture poster
-- ---------------------------------------------------------------------------

/*
 * Post a generated image as the bot.
 *
 * The path must already be under the bot's own folder in the `photos` bucket.
 * That is not decoration: `can_read_chat_media` lets a member read any path a
 * message in their conversation points at, so a caller who could name an
 * arbitrary path here could publish somebody else's object into a thread they
 * control and read it. Checking the prefix is what stops that, and it is
 * checked here rather than trusted from the Edge Function because this is the
 * boundary that has `security definer` on it.
 *
 * `caption` is what was asked for, which is worth keeping: it is the only
 * record of the prompt once the picture itself has been collected.
 */
create or replace function public.post_ai_photo(
  target_conversation uuid,
  photo_path text,
  caption text default ''
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
begin
  if photo_path is null or char_length(trim(photo_path)) = 0 then
    raise exception 'Empty photo path.';
  end if;

  if split_part(photo_path, '/', 1) <> bot::text then
    raise exception 'Photo must be in the assistant''s own folder.';
  end if;

  perform public.ai_may_post(target_conversation);

  insert into public.messages
    (conversation_id, sender_id, body, kind, photo_path, encryption, envelope)
  values
    (target_conversation, bot, left(coalesce(trim(caption), ''), 4000), 'photo',
     photo_path, null, null)
  returning id into msg_id;

  update public.conversations
  set last_message_at = now()
  where id = target_conversation;

  insert into public.ai_processing_log (user_id, conversation_id, role, body)
  values (me, target_conversation, 'assistant',
          left('[image] ' || coalesce(trim(caption), ''), 4000));

  return msg_id;
end;
$$;

revoke all on function public.post_ai_photo(uuid, text, text) from public;
grant execute on function public.post_ai_photo(uuid, text, text) to authenticated;
