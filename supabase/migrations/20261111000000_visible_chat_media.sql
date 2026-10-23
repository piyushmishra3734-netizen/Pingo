-- Which chat media files the caller may be handed a link to, for the R2 Worker.
--
-- Chat photos, voice notes, documents (and the videos that arrive as
-- documents) and Pings are moving from Supabase Storage to Cloudflare R2, where
-- reading costs no egress. Storage enforced who could read them with
-- `can_read_chat_media`; R2 has no policies, so the Worker asks this instead,
-- as the viewer, before it signs a link.
--
-- ## The same rule, not a new one
--
-- A file may be read by
--   1. the person who uploaded it (the user id is the second part of its path), or
--   2. a member of the conversation whose message names that path.
--
-- That is exactly `can_read_chat_media`, applied to `r2:` paths, whatever the
-- column. Nothing about who may see what changes by moving the bytes.
--
-- ## Why security definer
--
-- It reads `messages` and `conversation_members` on the caller's behalf the way
-- `can_read_chat_media` does, and uses `auth.uid()` for who is asking, so it
-- cannot be pointed at somebody else. The Worker forwards the viewer's own
-- token; there is no key anywhere that can ask on another person's behalf.
--
-- Additive: no table, column or policy changes, and nothing calls it until the
-- Worker that knows about it is deployed.

create or replace function public.visible_chat_media(p_paths text[])
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  with asked as (
    select distinct p as path, split_part(p, '/', 2) as owner
    from unnest(coalesce(p_paths, '{}'::text[])) as p
    where p like 'r2:%'
    limit 200
  )
  select a.path
  from asked a
  where auth.uid() is not null
    and (
      -- The uploader's own folder.
      a.owner = auth.uid()::text
      -- Or a member of a conversation a message names this file in.
      or exists (
        select 1
        from public.messages m
        join public.conversation_members cm
          on cm.conversation_id = m.conversation_id
         and cm.user_id = auth.uid()
        where m.photo_path = a.path
           or m.file_path = a.path
           or m.voice_path = a.path
           or m.snap_path = a.path
      )
    );
$$;

comment on function public.visible_chat_media(text[]) is
  'Of the asked-for r2: chat media paths, those the caller uploaded or may read as a member of the conversation. The Worker signs links only for these.';

revoke all on function public.visible_chat_media(text[]) from public, anon;
grant execute on function public.visible_chat_media(text[]) to authenticated;
