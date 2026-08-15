-- The rollout view undercounted, and the reason matters.
--
-- `build_rollout` filtered on `last_seen_at > now() - interval '30 minutes'`,
-- which reads as "devices active recently" and is not what that column means.
-- `last_seen_at` is presence, and presence is deliberately frozen when somebody
-- turns activity status off - "no news from now on" is the whole point of that
-- switch. So a device belonging to a privacy-conscious person reports its build
-- perfectly well and then never appears in the window.
--
-- ## The fix is not a second timestamp
--
-- The obvious repair - a `build_seen_at` written on every launch regardless of
-- the switch - would be a presence signal wearing a different name, on a table
-- whose select policy is `using (true)`. That is exactly the leak the switch
-- exists to prevent, and building it to make an operational graph tidier would
-- be indefensible.
--
-- So the view uses only what is already there, and reports two honest numbers
-- instead of one misleading one:
--
--   `devices`  - every device that has been seen in the last seven days, by
--                build. Complete, because a launch writes `build` whatever the
--                privacy switch says; imprecise, because a week is a long time.
--   `active`   - the subset whose presence is also recent. Precise, and blind
--                to anyone who has turned presence off.
--
-- Rollout is judged on `devices`. `active` is the corroborating number, and the
-- gap between them is the size of the blind spot rather than a mystery.
--
-- A null build is a device that has not launched since build reporting shipped,
-- which is to say: still on the old bundle. That is the number being watched.

/*
 * Dropped rather than replaced: `create or replace view` refuses to reorder or
 * rename columns, and this adds one in the middle. Nothing reads the view but
 * this investigation, so there is nothing to break.
 */
drop view if exists public.build_rollout;

create view public.build_rollout
with (security_invoker = true)
as
select
  coalesce(build, 'pre-instrumentation') as build,
  count(*) as devices,
  round(100.0 * count(*) / nullif(sum(count(*)) over (), 0), 1) as percent,
  count(*) filter (where last_seen_at > now() - interval '30 minutes') as active,
  max(last_seen_at) as newest
from public.device_keys
where last_seen_at > now() - interval '7 days'
group by 1
order by devices desc;

comment on view public.build_rollout is
  'Share of devices per build over the last seven days. `devices` is the rollout number; `active` is the subset with recent presence and undercounts anyone who has turned activity status off. Reads only columns device_keys already exposes.';
