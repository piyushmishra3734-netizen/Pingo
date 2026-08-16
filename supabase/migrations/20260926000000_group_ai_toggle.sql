-- Turning PINGO AI off in one group.
--
-- The AI was added to every group and community by hand, in bulk, and there has
-- never been a way to take it out of one of them. That is the wrong default to
-- have no escape from: a group that wants the assistant and a group that does
-- not are both ordinary, and only the people in the group know which they are.
--
-- ## Membership is the switch
--
-- No new column, no new table, no per-group settings row. The AI answers
-- because it is a member of the conversation - `sendMessage` checks exactly
-- that before it decides whether a message can go in plaintext - so removing
-- the membership row *is* turning it off, and it turns off every consequence
-- at once. A separate `ai_enabled` flag would have been a second source of
-- truth for the same question, and the day the two disagreed the group would
-- have an assistant it had switched off.
--
-- ## Admins only
--
-- Same rule as adding members and the invite link. Whether an assistant is in
-- the room is the room's decision, not a decision any one member makes for
-- everybody, and it is reversible by the same people either way.

create or replace function public.set_group_ai(conv uuid, enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_conversation_admin(conv) then
    raise exception 'Only an admin can change this.' using errcode = '42501';
  end if;

  -- Groups and communities only. A one-to-one thread with PINGO AI *is* the
  -- assistant; removing it from there would leave a conversation with one
  -- person in it.
  if not exists (
    select 1 from public.conversations c
    where c.id = conv and c.kind in ('group', 'community')
  ) then
    raise exception 'That is not a group.' using errcode = '22023';
  end if;

  if enabled then
    insert into public.conversation_members (conversation_id, user_id, role)
    values (conv, public.pingo_ai_user_id(), 'member')
    on conflict do nothing;
  else
    delete from public.conversation_members
    where conversation_id = conv
      and user_id = public.pingo_ai_user_id();
  end if;
end;
$$;

revoke all on function public.set_group_ai(uuid, boolean) from public;
grant execute on function public.set_group_ai(uuid, boolean) to authenticated;
