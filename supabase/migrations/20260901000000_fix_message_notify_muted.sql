-- Sending was broken for everyone, in every conversation.
--
-- `on_message_insert` filters the roster it notifies with
-- `coalesce(muted, false) = false`. `conversation_members.muted` was dropped in
-- 20260728180000, which replaced the boolean with `muted_until` precisely so a
-- mute could expire on its own rather than needing a second write at the moment
-- it lapsed.
--
-- The trigger fires on every insert into `public.messages`, so the missing
-- column did not degrade notifications - it aborted the statement. Every send,
-- from every account, in every thread, came back as:
--
--   400  42703  column "muted" does not exist
--
-- and the composer reported "That message could not be sent." Nothing about it
-- looked like a database error from the outside, which is why it read as the
-- whole product being down rather than as one predicate.
--
-- The replacement asks the question the schema now answers. "Not muted" is
-- `muted_until is null or muted_until <= now()`, which is the same computation
-- 20260728180000 uses for its own `muted` output - so an expired mute is
-- unmuted here at the same instant it is unmuted everywhere else, with no row
-- to update and no window where the two disagree.
--
-- Only the one predicate changes; the rest of the function is as it was.

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
      -- Computed from `muted_until`, so a mute that has run out is already over.
      and (muted_until is null or muted_until <= now())
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
