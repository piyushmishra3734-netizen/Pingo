-- The device ids a sealed envelope is wrapped to, and nothing else.
--
-- For an index that makes Restore history's `account_wrap_candidates` an
-- index lookup instead of a scan of every envelope (a 9 s timeout per call).
-- Not a GIN over `envelope->'keys'` itself: that also indexes every wrapped key
-- value, and passed 108 MB of a free-plan database before it was cancelled.
create or replace function public.envelope_devices(keys jsonb)
returns text[]
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case when jsonb_typeof(keys) = 'object'
              then coalesce((select array_agg(k) from jsonb_object_keys(keys) k), '{}'::text[])
              else '{}'::text[] end
$$;

revoke execute on function public.envelope_devices(jsonb) from public, anon, authenticated;
