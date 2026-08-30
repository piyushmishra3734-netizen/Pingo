-- Three append-only tables that nothing ever deleted from.
--
-- 25 accounts and 36k messages had produced 130,585 notification rows, 42,748
-- read advances and 27,485 delivery records - 52 MB of bookkeeping about 1.7 MB
-- of actual message text. None of it was wrong; none of it was ever bounded,
-- and an unbounded table on a 500 MB plan is a deadline rather than a design.

create or replace function public.prune_bookkeeping()
returns table (notifications bigint, reads bigint, deliveries bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  n bigint; r bigint; d bigint;
begin
  /*
   * A notification is a nudge, and a nudge nobody acted on in a week is not
   * going to be acted on. The message it points at is untouched - this deletes
   * the pointer, never the thing pointed to.
   */
  delete from public.notifications where created_at < now() - interval '7 days';
  get diagnostics n = row_count;

  /*
   * Read receipts keep their own history on purpose: `message_read_state` asks
   * for the *first* advance that covered a message, so "seen at 14:03" survives
   * opening the thread again at 18:00. Pruning that history does not break the
   * feature, because the function already falls back to the member's
   * `last_read_at` cursor for messages with no advance recorded - it is written
   * for exactly this case and says so. A receipt older than thirty days
   * degrades from "saw it at 14:03" to "had read the thread by then", which
   * nobody is reading a month-old thread to find out.
   */
  delete from public.conversation_reads where at < now() - interval '30 days';
  get diagnostics r = row_count;

  -- Delivery telemetry. Useful while chasing a push problem, useless after.
  delete from public.push_deliveries where sent_at < now() - interval '3 days';
  get diagnostics d = row_count;

  return query select n, r, d;
end;
$$;

revoke all on function public.prune_bookkeeping() from public, anon, authenticated;

-- Nightly, off the hour so it is not competing with everything else that runs
-- at midnight.
select cron.schedule(
  'prune-bookkeeping',
  '17 3 * * *',
  $$select public.prune_bookkeeping()$$
);
