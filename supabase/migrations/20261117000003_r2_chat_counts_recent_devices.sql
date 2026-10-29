-- A chat's media goes to R2 unless a device used in the last week cannot read it.
--
-- `conversation_can_use_r2` counted every device seen in thirty days. On
-- 2026-10-28 that was 56 of 83 - abandoned browser installs, a phone reset,
-- the same person's old APK - and 25 of the 27 chats with messages that week
-- had one, so no chat media at all reached R2 in three days (77 files, all on
-- Supabase Storage). A week is long enough that somebody who opens the app
-- weekly is never shown a broken photo, and short enough that an install
-- nobody opens stops holding a chat back.

create or replace function public.conversation_can_use_r2(p_conversation uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
    and public.app_flag('chat_media_r2')
    and public.is_conversation_member(p_conversation)
    and not exists (
      select 1
      from public.conversation_members cm
      join public.device_keys d on d.user_id = cm.user_id
      where cm.conversation_id = p_conversation
        and d.last_seen_at > now() - interval '7 days'
        and not ('r2chat' = any (d.caps))
    );
$$;
