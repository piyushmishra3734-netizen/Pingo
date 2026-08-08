-- Tighten private chat-media storage reads to owner + conversation members.
--
-- ## What was wrong
--
-- `voice`, `snaps` (Pings), `photos`, and `documents` used SELECT policies of
-- the form `bucket_id = '…'` for every authenticated user. Upload paths use
-- unguessable UUIDs and the app only mints short-lived signed URLs, but
-- Storage LIST still enumerates prefixes and objects. Any logged-in account
-- could list another user's folder and download Ping / voice / chat photo
-- bytes without being in that conversation.
--
-- ## What this does
--
-- Read is allowed only when:
--   1. the first path segment is the caller's uid (uploader / own folder), or
--   2. a `messages` row still references that object path and the caller is a
--      member of that conversation.
--
-- Upload and delete policies stay owner-prefix only. Public surface (avatars,
-- posts, stories) is unchanged.
--
-- ## Why a helper
--
-- Storage RLS cannot join `messages` inline cleanly across buckets; one
-- `security definer` predicate keeps the four policies identical and uses
-- `auth.uid()` so it cannot be pointed at another user.

create or replace function public.can_read_chat_media(p_bucket text, p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and p_name is not null
    and length(p_name) > 0
    and (
      -- Uploader folder: `{auth.uid()}/…`
      split_part(p_name, '/', 1) = auth.uid()::text
      or exists (
        select 1
        from public.messages m
        join public.conversation_members cm
          on cm.conversation_id = m.conversation_id
         and cm.user_id = auth.uid()
        where case p_bucket
          when 'voice' then m.voice_path = p_name
          when 'snaps' then m.snap_path = p_name
          when 'photos' then m.photo_path = p_name
          when 'documents' then m.file_path = p_name
          else false
        end
      )
    );
$$;

comment on function public.can_read_chat_media(text, text) is
  'Storage SELECT guard: own folder or conversation member for a message path.';

revoke all on function public.can_read_chat_media(text, text) from public;
grant execute on function public.can_read_chat_media(text, text) to authenticated;
-- Storage API evaluates policies as the signed-in role; service role bypasses RLS.

-- Path lookups on every signed URL / download.
create index if not exists messages_voice_path_idx
  on public.messages (voice_path)
  where voice_path is not null;

create index if not exists messages_snap_path_idx
  on public.messages (snap_path)
  where snap_path is not null;

create index if not exists messages_photo_path_idx
  on public.messages (photo_path)
  where photo_path is not null;

create index if not exists messages_file_path_idx
  on public.messages (file_path)
  where file_path is not null;

-- ---------------------------------------------------------------------------
-- voice
-- ---------------------------------------------------------------------------

drop policy if exists "members read voice" on storage.objects;
create policy "members read voice"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'voice'
    and public.can_read_chat_media(bucket_id, name)
  );

-- ---------------------------------------------------------------------------
-- snaps (Pings)
-- ---------------------------------------------------------------------------

drop policy if exists "authenticated can read snaps" on storage.objects;
create policy "members read snaps"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'snaps'
    and public.can_read_chat_media(bucket_id, name)
  );

-- ---------------------------------------------------------------------------
-- photos (chat photos — same private class as voice / Ping)
-- ---------------------------------------------------------------------------

drop policy if exists "members read photos" on storage.objects;
create policy "members read photos"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'photos'
    and public.can_read_chat_media(bucket_id, name)
  );

-- ---------------------------------------------------------------------------
-- documents
-- ---------------------------------------------------------------------------

drop policy if exists "members read documents" on storage.objects;
create policy "members read documents"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'documents'
    and public.can_read_chat_media(bucket_id, name)
  );
