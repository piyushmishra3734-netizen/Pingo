-- PINGO AI's replies carry what it knows about them: the web sources it cited,
-- and for a picture it drew, the prompt it drew from.
--
-- ## No new column
--
-- `messages.meta` (jsonb, 20260729180000_attachments) already exists and is
-- already readable by every member. The bot's part goes under one key, `ai`:
--
--   meta.ai = { sources?: [{ title, url }], image?: { revisedPrompt?, model? }, mood? }
--
-- The functions wrap whatever they are given in that key themselves, so a
-- caller can never write the other keys (`mentionedUserIds` would send
-- notifications as the bot, `storyId` would make a reply out of nothing).
--
-- ## Same functions, one more optional argument
--
-- `reply_meta` defaults to null, so a call with the old arguments still lands
-- here: an Edge Function deployed before or after this migration keeps
-- working. The old signatures are dropped rather than overloaded, because a
-- two-argument call matching two functions is an ambiguity error.
--
-- RLS is unchanged: both are still `security definer` behind `ai_may_post`.

drop function if exists public.post_ai_reply(uuid, text);

create or replace function public.post_ai_reply(
  target_conversation uuid,
  reply_body text,
  reply_meta jsonb default null
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

  insert into public.messages (conversation_id, sender_id, body, kind, encryption, envelope, meta)
  values (target_conversation, bot, left(trim(reply_body), 4000), 'text', null, null,
          public.ai_reply_meta(reply_meta))
  returning id into msg_id;

  update public.conversations
  set last_message_at = now()
  where id = target_conversation;

  insert into public.ai_processing_log (user_id, conversation_id, role, body)
  values (me, target_conversation, 'assistant', left(trim(reply_body), 4000));

  return msg_id;
end;
$$;

drop function if exists public.post_ai_photo(uuid, text, text);

create or replace function public.post_ai_photo(
  target_conversation uuid,
  photo_path text,
  caption text default '',
  reply_meta jsonb default null
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

  -- See 20260929000000_ai_photo: only the bot's own folder may be published.
  if split_part(photo_path, '/', 1) <> bot::text then
    raise exception 'Photo must be in the assistant''s own folder.';
  end if;

  perform public.ai_may_post(target_conversation);

  insert into public.messages
    (conversation_id, sender_id, body, kind, photo_path, encryption, envelope, meta)
  values
    (target_conversation, bot, left(coalesce(trim(caption), ''), 4000), 'photo',
     photo_path, null, null, public.ai_reply_meta(reply_meta))
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

/*
 * `{ ai: <meta> }`, or null. An object only, and small: a reply with an
 * oversized or malformed meta is still posted, just without it, because the
 * words matter more than their footnotes.
 */
create or replace function public.ai_reply_meta(reply_meta jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select case
    when reply_meta is null or jsonb_typeof(reply_meta) <> 'object' then null
    when pg_column_size(reply_meta) > 16384 then null
    else jsonb_build_object('ai', reply_meta)
  end;
$$;

revoke all on function public.ai_reply_meta(jsonb) from public;

revoke all on function public.post_ai_reply(uuid, text, jsonb) from public;
grant execute on function public.post_ai_reply(uuid, text, jsonb) to authenticated;

revoke all on function public.post_ai_photo(uuid, text, text, jsonb) from public;
grant execute on function public.post_ai_photo(uuid, text, text, jsonb) to authenticated;
