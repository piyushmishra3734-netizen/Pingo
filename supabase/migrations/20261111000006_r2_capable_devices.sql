-- Chat media goes to R2 only for chats where every device can read it.
--
-- A copy of PINGO that predates R2 chat media cannot open an `r2:` path, so the
-- switch could not simply be turned on for everybody: whoever had not updated
-- would see broken photos. Which build somebody runs was only a commit hash, and
-- a hash says nothing about what that build can do.
--
-- So a device now says so itself. `caps` is the list of things the app on that
-- device can do; the heartbeat that already reports its build adds `r2chat` once
-- the build can read R2 chat media. `conversation_can_use_r2` then answers, for
-- one chat, whether media may go to R2: only if the switch is on and every device
-- of every member (the sender's own other devices too) seen in the last 30 days
-- has that capability. One person on an old phone keeps that chat on Supabase
-- Storage until the phone is updated, and nobody else's chats are held back.
--
-- Additive. Nothing changes for anybody until the app reports `r2chat` and the
-- switch is on; a device that never reports it simply never counts as capable.

alter table public.device_keys
  add column if not exists caps text[] not null default '{}';

grant insert (caps), update (caps) on public.device_keys to authenticated;

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
        and d.last_seen_at > now() - interval '30 days'
        and not ('r2chat' = any (d.caps))
    );
$$;

revoke all on function public.conversation_can_use_r2(uuid) from public, anon;
grant execute on function public.conversation_can_use_r2(uuid) to authenticated;

notify pgrst, 'reload schema';
