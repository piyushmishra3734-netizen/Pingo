/*
 * Message notifications stop being visible after thirty days and never stop
 * being stored.
 *
 * `notification_history` reads with `created_at > now() - interval '30 days'`,
 * so a row older than that is invisible to every screen in the product. Nothing
 * deletes it. At the current rate that is six thousand rows a day - five per
 * message, one per recipient - accumulating forever behind a window that will
 * never show them again.
 *
 * ## Why only `message`
 *
 * The table's own note says notifications are dismissed rather than deleted,
 * because a missed call or an accepted follow request is history somebody may
 * come back for. That reasoning is right and it is not about this kind: a
 * message notification is a pointer to a message that is still sitting in the
 * thread, which is the actual record. An earlier migration
 * (`20260727000000_no_message_notifications`) deleted every one of them for
 * exactly that reason, before the push pipeline reintroduced them.
 *
 * So calls, mentions, follows and the rest are kept forever, and only the
 * duplicate-of-a-message rows age out - matched to the same thirty days the
 * screen already draws, so nothing disappears that anybody could have seen.
 *
 * ## Why this is worth a migration at all
 *
 * The database is the thing that decides how long PINGO keeps working. On the
 * free plan the ceiling is 500 MB, and of the ~6.9 MB a day this project is
 * currently writing, ~2 MB is this table. Messages themselves are the product
 * and have to be paid for; this part is a copy of a pointer to them.
 */

create or replace function public.prune_message_notifications()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer := 0;
begin
  delete from public.notifications
   where kind = 'message'
     and created_at < now() - interval '30 days';

  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.prune_message_notifications() from anon, authenticated;

-- Nightly, and off the hour: 03:41 is nobody's cron default, which keeps it
-- from landing on the same minute as every other job on the instance.
select cron.schedule(
  'pingo-notification-prune',
  '41 3 * * *',
  $$select public.prune_message_notifications();$$
);
