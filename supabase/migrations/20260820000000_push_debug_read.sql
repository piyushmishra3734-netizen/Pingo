-- Letting somebody see their own delivery record.
--
-- `push_deliveries`, `push_failures` and `dead_letter_notifications` all have
-- RLS on and no policies at all, which was right while only the sender touched
-- them. The debug panel needs the person's own rows, and "my notification did
-- not arrive" is exactly the question they cannot answer without them.
--
-- Own rows only, and read only. Nothing here is writable from a browser: these
-- are the pipeline's own record of what it did, and a client that could edit
-- them could hide a failure from the retry worker.

drop policy if exists "users read their own deliveries" on public.push_deliveries;
create policy "users read their own deliveries"
  on public.push_deliveries for select
  using (auth.uid() = user_id);

drop policy if exists "users read their own push failures" on public.push_failures;
create policy "users read their own push failures"
  on public.push_failures for select
  using (auth.uid() = user_id);

drop policy if exists "users read their own dead letters" on public.dead_letter_notifications;
create policy "users read their own dead letters"
  on public.dead_letter_notifications for select
  using (auth.uid() = user_id);

/**
 * Health, for whoever is allowed to ask.
 *
 * `push_metrics` is a view, and a view runs with its owner's rights - so
 * exposing it directly would let any signed-in user read delivery counts for
 * the whole product. This wraps it in a function that checks who is asking
 * first.
 *
 * The check is a username allowlist rather than a role column, because a role
 * system for one operator is a table, a policy and a migration to answer a
 * question that currently has one answer. It becomes a role the day there are
 * two people who need it.
 */
create or replace function public.push_health()
returns table (
  delivered bigint,
  dead_letters bigint,
  queued bigint,
  pruned_tokens bigint,
  retries_before_success bigint,
  avg_latency_ms numeric,
  success_rate_percent numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid()
      and username in ('kashish_', 'piuxxh')
  ) then
    raise exception 'not allowed';
  end if;

  return query select * from public.push_metrics;
end;
$$;

revoke all on function public.push_health() from public;
grant execute on function public.push_health() to authenticated;
