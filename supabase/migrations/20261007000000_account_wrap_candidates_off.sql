-- Old history repair is retired: old APKs and cached app shells still run it
-- automatically on every launch, and each call scanned every sealed envelope
-- until the statement timeout - the timeouts slowing sends for everyone on
-- 2026-09-14. An empty answer reads as "complete" to those clients, so they
-- stop asking. Same signature, so nothing that calls it breaks.
create or replace function public.account_wrap_candidates(my_device text, after_id uuid default null, batch integer default 250)
returns table(id uuid, epk text, wrap jsonb)
language sql
stable
security definer
set search_path to 'public'
as $$
  select null::uuid, null::text, null::jsonb where false
$$;
