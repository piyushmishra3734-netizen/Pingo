-- Mention notifications for group chats and story captions.
--
-- ## Why the client puts ids in `messages.meta`
--
-- Group chat bodies are usually end-to-end encrypted. The database cannot read
-- `@handle` out of ciphertext, so the sender resolves who was mentioned while
-- the plaintext is still on the device and writes those user ids into
-- `meta.mentionedUserIds`. The trigger only needs the roster + that list — it
-- never needs to decrypt the body.
--
-- Mentioned members get `kind = 'mention'` (push: "Mentioned you") instead of a
-- plain `message` row. Everyone else still gets the ordinary message kind.
--
-- ## Stories
--
-- Story captions are plaintext on the server. When someone posts with `@name`
-- in the caption, we resolve usernames and notify those people the same way.

create or replace function public.on_message_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  member record;
  event_kind text;
  mentioned jsonb;
  is_mentioned boolean;
begin
  -- System notices are not messages for the inbox.
  if new.kind = 'system' then
    return new;
  end if;

  event_kind := case new.kind
    when 'snap' then 'snap'
    when 'voice' then 'voice'
    when 'call' then 'call'
    else 'message'
  end;

  mentioned := case
    when new.meta is not null and new.meta ? 'mentionedUserIds'
      then new.meta->'mentionedUserIds'
    else '[]'::jsonb
  end;

  for member in
    select user_id
    from public.conversation_members
    where conversation_id = new.conversation_id
      and user_id <> new.sender_id
      -- Muted threads stay quiet, including @mentions (same as WhatsApp mute).
      and coalesce(muted, false) = false
  loop
    is_mentioned := mentioned @> to_jsonb(member.user_id::text)
      or mentioned @> jsonb_build_array(member.user_id);

    perform public.notify_user(
      member.user_id,
      new.sender_id,
      case when is_mentioned then 'mention' else event_kind end,
      new.conversation_id
    );
  end loop;

  return new;
end;
$$;

-- Story caption @mentions → mention notifications (subject = story id).
create or replace function public.on_story_insert_mentions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  handle text;
  target uuid;
  matches text[];
begin
  if new.caption is null or btrim(new.caption) = '' then
    return new;
  end if;

  -- Every @token that looks like a username (2–32 alnum/underscore).
  for matches in
    select regexp_matches(new.caption, '@([a-zA-Z0-9_]{2,32})', 'g')
  loop
    handle := lower(matches[1]);

    -- Skip the AI bot handle — nothing to wake up.
    if handle in ('pingoai', 'pingo_ai') then
      continue;
    end if;

    select p.id into target
    from public.profiles p
    where lower(p.username) = handle
    limit 1;

    if target is null or target = new.author_id then
      continue;
    end if;

    -- subject_id is the story id (not a conversation). Clients open via actor.
    perform public.notify_user(target, new.author_id, 'mention', new.id);
  end loop;

  return new;
exception
  when others then
    -- Never undo a posted story because a mention fan-out failed.
    return new;
end;
$$;

drop trigger if exists stories_notify_mentions on public.stories;
create trigger stories_notify_mentions
  after insert on public.stories
  for each row
  execute function public.on_story_insert_mentions();

comment on function public.on_story_insert_mentions() is
  'Fans out mention notifications for @handles in a new story caption.';
