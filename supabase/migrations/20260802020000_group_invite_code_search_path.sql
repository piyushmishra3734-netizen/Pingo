-- `group_invite_code` could not generate a code.
--
-- `gen_random_bytes` comes from pgcrypto, and Supabase installs pgcrypto into
-- the `extensions` schema — not `public`. The function pins
-- `set search_path = public`, which is the right instinct (an unpinned
-- search_path on a `security definer` function is how privilege escalation gets
-- in) and it also put pgcrypto out of reach. Every call raised
-- "function gen_random_bytes(integer) does not exist", so no group could ever
-- issue an invite link.
--
-- Caught by running the function rather than by reading it: the migration
-- applied cleanly, because a missing function inside a plpgsql body is resolved
-- at execution and not at creation.
--
-- Fixed by widening the pin rather than removing it. `extensions` is
-- Supabase-owned and not writable by application roles, so naming it is safe in
-- a way that leaving the path open would not be.

create or replace function public.group_invite_code(conv uuid)
returns text
language plpgsql
security definer
set search_path = public, extensions
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
   * 72 bits, made URL-safe.
   *
   * Not a sequence and not anything derived from the group's id: a guessable
   * code is an open door, and a code that encodes the conversation would let
   * anyone holding one link probe for others.
   */
  fresh := replace(
    replace(encode(extensions.gen_random_bytes(9), 'base64'), '/', '_'),
    '+',
    '-'
  );

  insert into public.conversation_invites (code, conversation_id, created_by)
  values (fresh, conv, auth.uid());

  return fresh;
end;
$$;

revoke all on function public.group_invite_code(uuid) from public;
grant execute on function public.group_invite_code(uuid) to authenticated;
