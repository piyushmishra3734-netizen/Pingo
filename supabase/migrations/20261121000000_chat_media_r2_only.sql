-- Chat media lives on R2, and Supabase Storage stops taking it.
--
-- Supabase egress was close to the free plan's 5 GB. R2 serves with no egress,
-- but a chat only went to R2 when every member's device had said it could read
-- it (conversation_can_use_r2), so a few old installs kept whole chats - 40 MB
-- videos included - on Supabase.
--
-- 1. R2 for every chat: the device check is gone. The flag and membership stay.
--    An install that predates R2 can no longer open new media in these chats
--    until it updates; that is accepted.
-- 2. Supabase Storage refuses new photos, documents (videos too), voice notes and
--    snaps from people, unless the flag chat_media_supabase_upload is on. An old
--    install's upload now fails visibly instead of quietly costing egress.
--    Turning the flag on again is the whole rollback:
--      update app_flags set enabled = true where key = 'chat_media_supabase_upload';
--    Reading what is already there is untouched, and so are the service-role
--    writes of the AI's own pictures.

create or replace function public.conversation_can_use_r2(p_conversation uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select auth.uid() is not null
    and public.app_flag('chat_media_r2')
    and public.is_conversation_member(p_conversation);
$$;

insert into public.app_flags (key, enabled, user_ids, note)
values (
  'chat_media_supabase_upload',
  false,
  '{}',
  'Allow chat photos, documents, voice and snaps to be uploaded to Supabase Storage. Off: they go to R2 only, and an install that cannot do that fails to send media until it updates.'
)
on conflict (key) do nothing;

drop policy if exists "senders upload documents" on storage.objects;
create policy "senders upload documents" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = (auth.uid())::text
    and public.app_flag('chat_media_supabase_upload')
  );

drop policy if exists "senders upload photos" on storage.objects;
create policy "senders upload photos" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = (auth.uid())::text
    and public.app_flag('chat_media_supabase_upload')
  );

drop policy if exists "senders upload voice" on storage.objects;
create policy "senders upload voice" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'voice'
    and (storage.foldername(name))[1] = (auth.uid())::text
    and public.app_flag('chat_media_supabase_upload')
  );

drop policy if exists "snap owner can upload" on storage.objects;
create policy "snap owner can upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'snaps'
    and (storage.foldername(name))[1] = (auth.uid())::text
    and public.app_flag('chat_media_supabase_upload')
  );
