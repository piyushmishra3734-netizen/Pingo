/*
 * Devices that stopped existing were still being encrypted to.
 *
 * ## The cost, measured
 *
 * Every message carries one wrapped key per recipient device, in
 * `messages.envelope->'keys'`. On 2026-08-19 that object averaged **19.5
 * entries and 3,150 bytes** against a `body` averaging 47 - so `envelope` was
 * 58 MB of an 80 MB table, and the single biggest thing in the database.
 *
 * There were 61 rows in `device_keys` for 22 people, one account holding 18.
 * None of them were phones. They were browser sessions: every private window,
 * every cleared site data, every reinstall registers a device that never
 * unregisters. Twenty-two had been used in the last week. The rest were being
 * paid for on every message sent to their owners, forever.
 *
 * A message costs what its recipients' dead sessions cost. That is the bug.
 *
 * ## Why `last_seen_at` could not be used to find them
 *
 * It looks like exactly the column for this and it is not. `publishDeviceKey`
 * and the heartbeat both write it *only when the owner has activity status on*,
 * because it is the presence signal - so a device somebody uses every day looks
 * untouched for a month if they turned that switch off. Pruning on it would
 * delete live keys, and a device whose key is gone is left out of every
 * envelope written before it next launches: those messages are unreadable on
 * that device permanently. Silent, and unrecoverable.
 *
 * ## The signal used instead
 *
 * `key_seen_at`, stamped by a trigger on every insert or update of the row.
 *
 * The client needs no change and gets no say: `publishDeviceKey` already
 * upserts this row on every single launch, so the row is touched exactly when
 * the device is alive. The heartbeat touches it too, which only ever makes the
 * timestamp fresher - and that is the safe direction. This signal can keep a
 * dead device too long. It cannot report a live one as dead.
 *
 * It is deliberately not readable by clients. It would otherwise be a second,
 * ungated "last online" for anybody who can read your key rows - which is
 * everybody you talk to, since that is how they encrypt to you - and would hand
 * back the exact fact the activity-status switch exists to withhold.
 *
 * ## Evicting without banning
 *
 * `revoke_device` writes a tombstone in `revoked_devices` and the insert policy
 * refuses that id forever: the device signs itself out and wipes. That is right
 * for "throw my old phone off my account" and completely wrong here. A session
 * pruned for being quiet has done nothing wrong, so it is a plain delete - it
 * republishes on next launch and carries on, having missed only what was sent
 * while it was away.
 *
 * ## The edge that would have cost somebody their messages
 *
 * Prune everything unseen for 45 days and an account left alone for a season
 * ends up with zero keys. `everyoneReady` goes false, and anything still sent
 * is encrypted to nobody on their side - unreadable even after they come back
 * and republish. So the newest device of each account is never pruned, however
 * old it is. An account always has somebody to encrypt to.
 */

-- ---------------------------------------------------------------------------
-- 1. A liveness signal that is actually about the key
-- ---------------------------------------------------------------------------

alter table public.device_keys
  add column if not exists key_seen_at timestamptz not null default now();

comment on column public.device_keys.key_seen_at is
  'When this device last published or touched its own key row - every launch, regardless of privacy settings. Server-stamped, never client-supplied, never readable by clients. Used only to decide which keys are still worth encrypting to.';

/*
 * Backfilled from what is already known rather than from `now()`, or every
 * existing dead session would look brand new and survive the first 45 days for
 * nothing.
 */
update public.device_keys
   set key_seen_at = greatest(created_at, coalesce(last_seen_at, created_at))
 where key_seen_at is null
    or key_seen_at > greatest(created_at, coalesce(last_seen_at, created_at));

create or replace function public.device_keys_stamp_seen()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Server clock, not the client's. A device cannot buy itself immortality by
  -- sending a timestamp from next year.
  new.key_seen_at := now();
  return new;
end;
$$;

drop trigger if exists device_keys_stamp_seen on public.device_keys;
create trigger device_keys_stamp_seen
  before insert or update on public.device_keys
  for each row execute function public.device_keys_stamp_seen();

/*
 * Writable by its owner through the ordinary upsert, readable by nobody.
 *
 * `revoke select (key_seen_at) ... from authenticated` does nothing on its own,
 * which is worth writing down because it looks like it works: a table-wide
 * SELECT grant already covers every column, and a column-level revoke cannot
 * punch a hole in it. The grant has to come off the table and go back on as a
 * list. Checked with `information_schema.column_privileges` afterwards, which
 * is the only way to see the difference.
 *
 * `anon` is left alone: the SELECT policy is `to authenticated`, so an
 * anonymous caller already reads nothing, and revoking would turn today's empty
 * list into a 403 for any code path that happens to ask before sign-in.
 */
revoke select on public.device_keys from authenticated;

grant select (device_id, user_id, public_key, created_at, last_seen_at, label, build)
  on public.device_keys to authenticated;

-- ---------------------------------------------------------------------------
-- 2. A ceiling, so no account can ever get back to eighteen
-- ---------------------------------------------------------------------------

/*
 * Eight, which is more devices than anybody has and fewer than a fortnight of
 * testing produces. Signal allows five linked; this is deliberately looser,
 * because the failure of being too tight is somebody's real second browser
 * losing a day of messages, and the failure of being too loose is a few
 * kilobytes.
 */
create or replace function public.device_keys_enforce_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.device_keys d
   where d.user_id = new.user_id
     and d.device_id <> new.device_id
     and d.device_id not in (
       select device_id
         from public.device_keys
        where user_id = new.user_id
          and device_id <> new.device_id
        order by key_seen_at desc
        limit 7
     );

  return null;
end;
$$;

drop trigger if exists device_keys_enforce_limit on public.device_keys;
create trigger device_keys_enforce_limit
  after insert on public.device_keys
  for each row execute function public.device_keys_enforce_limit();

-- ---------------------------------------------------------------------------
-- 3. The nightly sweep
-- ---------------------------------------------------------------------------

/*
 * Both rules in one pass, because they are one question: is this key still
 * worth encrypting to?
 *
 * The trigger above only fires when a *new* device appears, so an account that
 * is already over the ceiling would sit there until it happened to register
 * another one. The sweep is what actually brings it down, and it is also where
 * the 45-day rule lives - once a night, on a table with a handful of rows per
 * person, rather than on every launch.
 *
 * `rank > 1` is the guard that matters: whatever else is true, the most
 * recently seen key of every account survives. An account with no keys is one
 * that people can send permanently unreadable messages to. See the header.
 */
create or replace function public.prune_stale_device_keys()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer := 0;
begin
  with ranked as (
    select device_id,
           row_number() over (partition by user_id order by key_seen_at desc) as rank,
           key_seen_at
      from public.device_keys
  )
  delete from public.device_keys d
   using ranked r
   where r.device_id = d.device_id
     and r.rank > 1
     and (r.rank > 8 or r.key_seen_at < now() - interval '45 days');

  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.prune_stale_device_keys() from anon, authenticated;

select cron.schedule(
  'pingo-device-key-prune',
  '23 4 * * *',
  $$select public.prune_stale_device_keys();$$
);
