-- The status itself, shown to everybody.
--
-- online / invisible / do not disturb was split so nobody could tell invisible
-- from do not disturb. The product wants the opposite: whichever of the two
-- somebody chose is shown to everyone, all the time, as a moon or a bar - and
-- only online is left to come and go with whether they are actually here.
--
-- So the status gets a column on the world-readable table, which is already in
-- the realtime publication, and everybody's copy of the app hears it change.
-- online_status stays exactly what it was (on only for online): the presence
-- channel, the heartbeat and the device_keys freeze all read it. And
-- notification_prefs.dnd stays the push gate's input. The client writes all
-- three together in one place, savePresenceStatus.
--
-- Applied to gpijpmepzowwhvgkriqu through the Supabase MCP as
-- `presence_status_public`.

alter table public.privacy_settings
  add column if not exists presence_status text not null default 'online'
  check (presence_status in ('online', 'invisible', 'dnd'));

comment on column public.privacy_settings.presence_status is
  'online / invisible / dnd, shown to everyone. online_status mirrors it (true only for online) for the presence enforcement; notification_prefs.dnd mirrors dnd for the push gate.';

-- Everybody who already chose, carried across.
update public.privacy_settings s
   set presence_status = case
     when exists (
       select 1 from public.notification_prefs n where n.user_id = s.user_id and n.dnd
     ) then 'dnd'
     when s.online_status is false then 'invisible'
     else 'online'
   end;
