-- Which build each device is actually running.
--
-- A deploy was live for fifteen hours while the fleet went on running the
-- previous bundle, and nothing in production could say so. Every measurement
-- taken during that window was measuring the old code without knowing it, and
-- the only reason it was caught was that a query which should have gone to zero
-- had not moved at all.
--
-- One column answers it. `device_keys` already has a row per device, already
-- written on every launch and touched by the heartbeat, so this costs no new
-- table, no new request, and no new round trip.
--
-- ## What it is, and what it deliberately is not
--
-- A seven-character commit hash. It says which code is running and nothing
-- about who is running it - no version of a browser, no screen, no location.
-- Joined with `last_seen_at`, which is already here, it answers the only
-- question being asked: what share of active devices is on the new build, and
-- is that share rising.

alter table public.device_keys
  add column if not exists build text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'device_keys_build_length') then
    alter table public.device_keys
      add constraint device_keys_build_length check (
        build is null or char_length(build) between 1 and 40
      );
  end if;
end
$$;

comment on column public.device_keys.build is
  'Commit hash of the bundle this device last ran. Reported by the client on launch and on each heartbeat; used only to measure rollout.';

/*
 * The rollout, as one row per build.
 *
 * A view rather than a query somebody has to remember. "Active" is thirty
 * minutes of `last_seen_at`, which is the same window presence already treats
 * as recent - long enough to include a phone in somebody's pocket, short
 * enough that a device switched off last week is not counted as evidence the
 * rollout has stalled.
 *
 * `security_invoker` so it cannot be used to read more than the caller could
 * read anyway.
 */
create or replace view public.build_rollout
with (security_invoker = true)
as
select
  coalesce(build, 'unknown') as build,
  count(*) as devices,
  round(100.0 * count(*) / nullif(sum(count(*)) over (), 0), 1) as percent,
  max(last_seen_at) as newest
from public.device_keys
where last_seen_at > now() - interval '30 minutes'
group by 1
order by devices desc;

comment on view public.build_rollout is
  'Share of recently-active devices per build. Reads device_keys, which is already world-readable by design - a public key is public.';
