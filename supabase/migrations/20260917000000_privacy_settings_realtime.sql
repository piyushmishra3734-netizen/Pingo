-- The privacy rules have to travel, or the switch only works where it is thrown.
--
-- Activity status is per account and the app keeps a local copy so the
-- heartbeat and the presence channel can read it without a query every minute.
-- A copy is only as good as its news: turning the switch off on a phone left a
-- laptop broadcasting until something happened to re-read the row - which is
-- exactly the "sometimes it doesn't update" this fixes.
--
-- Adding the table to the publication is what lets every signed-in client hear
-- the change as it happens: their own row updates the cache, and somebody
-- else's takes their dot away from the people watching.
--
-- Nothing is exposed by this that was not already readable: the row is
-- world-readable by policy (`privacy_settings_read`), because a rule about what
-- may be shown has to be knowable by whoever is doing the showing.

-- Guarded, because adding a table twice is an error rather than a no-op, and a
-- migration that cannot be re-run is a migration that blocks the next one.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'privacy_settings'
  ) then
    alter publication supabase_realtime add table public.privacy_settings;
  end if;
end
$$;
