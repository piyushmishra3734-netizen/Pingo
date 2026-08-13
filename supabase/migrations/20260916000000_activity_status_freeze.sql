-- "Show activity status" enforced by the database, not by whoever is asking.
--
-- The switch is honoured in the app three times over: the presence channel does
-- not track, the heartbeat does not write, and the device-key publish leaves
-- the timestamp alone. All three live in the client - which is fine for the
-- client that has them, and useless against the one that does not. A tab opened
-- before the release, a phone still on last week's APK, a second browser left
-- running: each of those keeps writing `last_seen_at` every minute and lights
-- the dot for somebody who has asked to be invisible.
--
-- A privacy switch that only works on up-to-date builds is not a privacy
-- switch. So the rule moves to the one place every client has to go through.
--
-- Updates only. A device's first row is written once, when it publishes its key
-- for the first time, and blocking that would leave the column null on a table
-- that expects a time; the very next beat is where the freezing starts, which
-- is a two-minute exposure once per device rather than one every minute for
-- ever. Turning the switch back on lets the next write through as normal.

create or replace function public.device_keys_respect_activity_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.privacy_settings s
    where s.user_id = new.user_id
      and s.online_status is false
  ) then
    -- Keep whatever the row already said. Not the epoch, and not null: the
    -- honest answer to "when were they last seen" is the last time they were,
    -- which is exactly what is already stored.
    new.last_seen_at := old.last_seen_at;
  end if;
  return new;
end;
$$;

drop trigger if exists device_keys_respect_activity_status on public.device_keys;

create trigger device_keys_respect_activity_status
  before update on public.device_keys
  for each row
  execute function public.device_keys_respect_activity_status();

comment on function public.device_keys_respect_activity_status is
  'Freezes device_keys.last_seen_at while the owner has privacy_settings.online_status off, so an out-of-date client cannot report them as present.';
