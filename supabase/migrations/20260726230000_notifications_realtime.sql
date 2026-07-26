-- Put `notifications` on the wire.
--
-- The table, its triggers and the client subscription were all correct, and
-- none of it fired: `postgres_changes` only delivers for tables in the
-- `supabase_realtime` publication, and this one was never added. The messaging
-- migration remembered to do it for `messages`; this was the same step, missed.
--
-- The failure mode is why it went unnoticed — nothing errors. The subscription
-- reports SUBSCRIBED, the triggers write rows, and the client simply never
-- hears about them. Silence that looks like "no notifications yet".

do $$
begin
  alter publication supabase_realtime add table public.notifications;
exception
  -- Already added, which is the normal case on a re-run.
  when duplicate_object then null;
end;
$$;

/*
 * `replica identity full` so the row arrives complete.
 *
 * The default sends only the primary key for updates, which is enough to know
 * *that* something changed but not what it was. Marking a notification read has
 * to reach other tabs with its id intact, and the badge needs the payload to
 * decide anything at all.
 */
alter table public.notifications replica identity full;
