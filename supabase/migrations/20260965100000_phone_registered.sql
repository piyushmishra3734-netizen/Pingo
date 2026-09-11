-- Whether a number already has an account, asked by phone sign-up.
--
-- Sign-up by number is a code and then a password. For a number that already
-- has an account, the code signs into that account and the password screen
-- then replaces its password - the person meant to join, and instead quietly
-- reset somebody's (usually their own) account. So sign-up asks first, and a
-- registered number goes to Log In with "Looks like you're already with us",
-- the same § 17 path a taken identifier has always taken, before a call is
-- paid for.
--
-- This does say which numbers have PINGO. That is the deliberate § 17 trade
-- (see features/auth/messages.ts), made only at sign-up.
-- ponytail: no rate limit of its own; move it behind an edge function with one
-- if anybody starts walking number ranges.
--
-- Applied to gpijpmepzowwhvgkriqu through the Supabase MCP as
-- `phone_registered`.

create or replace function public.phone_registered(p_phone text)
returns boolean
language sql
stable
security definer
set search_path = auth, public
as $$
  select exists (
    select 1
      from auth.users u
     where u.phone = regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')
       and u.phone <> ''
       and u.deleted_at is null
  );
$$;

revoke all on function public.phone_registered(text) from public;
grant execute on function public.phone_registered(text) to anon, authenticated;
