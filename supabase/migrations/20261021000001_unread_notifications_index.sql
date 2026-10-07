-- unread_notifications() counts `user_id = me and read_at is null`, and the
-- only index was (user_id, created_at): every badge refresh walked all of a
-- person's notifications to find the few unread ones - 168 ms and 1,117
-- buffers for one count on 2026-10-06. A partial index over just the unread.
create index if not exists notifications_unread_only_idx
  on public.notifications (user_id)
  where read_at is null;
