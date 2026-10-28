-- The read cursor moves only when it caught up on something.
--
-- Both functions already knew whether a read was news - they used it to decide
-- whether to write a receipt - and then moved `last_read_at` to `now()` anyway.
-- That second write changes nothing anyone can see: unread counts and ticks
-- only compare the cursor with messages from *other* people, and when none
-- arrived since the last read there is nothing for it to pass.
--
-- It was not free. `last_read_at` is one of the three values in the chat
-- list's fingerprint (`#listFingerprint`), and it is RLS-scoped across every
-- conversation you share - so a friend reopening a thread they had already
-- read changed *your* fingerprint, and your app threw its cached list away and
-- read all nine queries again. Measured on 2026-10-28: 1,681 calls a day,
-- 368 full list rebuilds out of 466 checks, and 164k `conversation_members`
-- updates fanned out over realtime since September.

create or replace function public.mark_conversation_read(conv uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  previous timestamptz;
  now_at timestamptz := now();
begin
  if me is null then
    raise exception 'not authenticated';
  end if;

  select m.last_read_at into previous
  from public.conversation_members m
  where m.conversation_id = conv and m.user_id = me;

  -- Not a member: say nothing either way. Raising here would let anyone probe
  -- for the existence of a conversation by the shape of the error.
  if previous is null then
    return;
  end if;

  /*
   * Only record an advance that actually caught up on something - the
   * receipt, and now the cursor too.
   *
   * Re-opening a thread you have already read used to move the cursor to
   * `now()` and change nothing anyone can observe, except every other
   * member's list fingerprint. Your own messages do not count. Nobody wants a
   * receipt saying they read themselves.
   */
  if not exists (
    select 1
    from public.messages msg
    where msg.conversation_id = conv
      and msg.sender_id <> me
      and msg.created_at > previous
      and msg.created_at <= now_at
  ) then
    return;
  end if;

  insert into public.conversation_reads (conversation_id, user_id, upto, at)
  values (conv, me, now_at, now_at)
  on conflict do nothing;

  update public.conversation_members
  set last_read_at = now_at
  where conversation_id = conv and user_id = me;
end;
$$;

/*
 * `mark_conversation_read`, for a given account rather than `auth.uid()`.
 * Only the service role may call it: `push-action` has checked the device's
 * key before it does.
 */
create or replace function public.mark_conversation_read_as(target_user uuid, conv uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  previous timestamptz;
  now_at timestamptz := now();
begin
  select m.last_read_at into previous
  from public.conversation_members m
  where m.conversation_id = conv and m.user_id = target_user;

  if previous is null then
    return;
  end if;

  if not exists (
    select 1 from public.messages msg
    where msg.conversation_id = conv and msg.sender_id <> target_user
      and msg.created_at > previous and msg.created_at <= now_at
  ) then
    return;
  end if;

  insert into public.conversation_reads (conversation_id, user_id, upto, at)
  values (conv, target_user, now_at, now_at)
  on conflict do nothing;

  update public.conversation_members
  set last_read_at = now_at
  where conversation_id = conv and user_id = target_user;
end;
$$;

revoke all on function public.mark_conversation_read_as(uuid, uuid) from public, anon, authenticated;
