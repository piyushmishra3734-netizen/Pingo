-- A last-seen line the operator writes himself.
--
-- While it is set, everybody sees "last seen <this>" for him instead of a
-- time, and the app keeps him invisible: no online dot, no read receipts, no
-- typing. Only the operator's account may set it; the check names the id
-- rather than calling auth.uid() so it holds however the row is written.
alter table public.privacy_settings
  add column if not exists custom_last_seen text;

alter table public.privacy_settings drop constraint if exists privacy_settings_custom_last_seen_check;
alter table public.privacy_settings
  add constraint privacy_settings_custom_last_seen_check check (
    custom_last_seen is null
    or (user_id = 'f32129ea-9ecd-4e56-a67c-d9837e9e2cc2'::uuid and char_length(custom_last_seen) between 1 and 48)
  );

grant update (custom_last_seen) on public.privacy_settings to authenticated;
grant insert (custom_last_seen) on public.privacy_settings to authenticated;
