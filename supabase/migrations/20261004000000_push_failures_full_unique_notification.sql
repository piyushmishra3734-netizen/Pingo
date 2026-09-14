-- The push-failure queue's unique key, usable by ON CONFLICT again.
--
-- `on_notification_push` records a failed push with
--   insert into push_failures ... on conflict (notification_id) do nothing
-- and the only unique index on that column was partial
-- (`where notification_id is not null`). Postgres cannot infer a partial index
-- from a bare `on conflict (notification_id)`, so the insert itself raised
-- 42P10 - inside the trigger's own error handler - and took the statement that
-- fired it down with it.
--
-- The visible damage: `notify_new_device` inserts a notification when a device
-- publishes its key for the first time, so no new device could publish (243
-- failed `device_keys` upserts in an hour, 4 users), and every
-- `messages_page` call from such a device was refused as "unknown device" and
-- fell back to the old full-envelope query. `notify_user` swallows errors, so
-- other notifications failed silently instead.
--
-- A plain unique index is equivalent - Postgres treats NULLs as distinct - and
-- the conflict target now matches it. The table was empty when this ran.
--
-- Applied to gpijpmepzowwhvgkriqu through the Supabase MCP as
-- `push_failures_full_unique_notification`.

create unique index if not exists push_failures_notification_id_key
  on public.push_failures (notification_id);

drop index if exists public.push_failures_notification_uniq;
