-- Notifications leave `postgres_changes`; activity is broadcast to its owner.
--
-- Every chat message writes one notification row per recipient, because the
-- push pipeline is built on those rows (`notifications_push`, the retry queue,
-- the per-chat unread count in the push). Measured on 2026-10-28: 8,400 rows a
-- day, 92% of them from one fourteen-person group. Each row was inserted,
-- marked read when the chat was read, and deleted after a week - and with the
-- table in `supabase_realtime` under REPLICA IDENTITY FULL, every one of those
-- writes was decoded and shipped to Realtime with the whole row, twice for
-- updates and deletes.
--
-- Nothing on a device displays a chat notification live: the badge ignores the
-- chat kinds ("read in the chat itself") and the Activity feed excludes them.
-- So the table leaves the publication, and the kinds a device does show -
-- follows, mentions, calls, new devices - are sent by the database straight to
-- the owner's private `notifications:{userId}` topic, the same pattern as
-- `call:{userId}`. The push pipeline is untouched.
--
-- Older app builds still subscribe to the table and now hear nothing; their
-- Activity badge updates on the next load instead of live.

alter publication supabase_realtime drop table public.notifications;

-- Nothing reads the old row any more; the full copy only made WAL bigger.
alter table public.notifications replica identity default;

create or replace function public.broadcast_activity_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform realtime.send(
    jsonb_build_object(
      'id', new.id,
      'kind', new.kind,
      'actor_id', new.actor_id,
      'subject_id', new.subject_id,
      'created_at', new.created_at
    ),
    'notification',
    'notifications:' || new.user_id::text,
    true
  );
  return null;
exception
  -- A badge that cannot be nudged must never stop the notification being written.
  when others then
    return null;
end;
$$;

revoke all on function public.broadcast_activity_notification() from public, anon, authenticated;

drop trigger if exists notifications_broadcast on public.notifications;
create trigger notifications_broadcast
after insert on public.notifications
for each row
-- The chat kinds nothing on a device shows. Mentions stay: the Activity feed lists them.
when (new.kind not in ('message', 'voice', 'snap', 'ai'))
execute function public.broadcast_activity_notification();

drop policy if exists "receive own notification topic" on realtime.messages;
create policy "receive own notification topic"
on realtime.messages
for select
to authenticated
using (
  realtime.topic() = 'notifications:' || auth.uid()::text
  and extension = 'broadcast'
);
