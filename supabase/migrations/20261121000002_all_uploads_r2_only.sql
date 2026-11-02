-- No user uploads to Supabase Storage at all.
--
-- 20261121000000 closed photos, documents, voice and snaps behind the flag
-- `chat_media_supabase_upload`. This closes the rest of what people can write:
-- profile photos and covers and group pictures and wallpapers (`avatars`), post
-- images (`posts`) and stories (`stories`). The app puts every one of them on R2
-- through the media Worker and has no fallback; an old install's upload now
-- fails visibly instead of quietly costing egress.
--
-- The flag is the whole rollback, for all of them:
--   update app_flags set enabled = true where key = 'chat_media_supabase_upload';
-- Reading what is already there is untouched, and so are the operator's
-- onboarding media and the service role's writes.

drop policy if exists "users upload their own avatar" on storage.objects;
create policy "users upload their own avatar" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (auth.uid())::text
    and public.app_flag('chat_media_supabase_upload')
  );

drop policy if exists "users replace their own avatar" on storage.objects;
create policy "users replace their own avatar" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (auth.uid())::text
    and public.app_flag('chat_media_supabase_upload')
  );

drop policy if exists "authors upload post images" on storage.objects;
create policy "authors upload post images" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'posts'
    and (storage.foldername(name))[1] = (auth.uid())::text
    and public.app_flag('chat_media_supabase_upload')
  );

drop policy if exists "users upload their own story media" on storage.objects;
create policy "users upload their own story media" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'stories'
    and (storage.foldername(name))[1] = (auth.uid())::text
    and public.app_flag('chat_media_supabase_upload')
  );
