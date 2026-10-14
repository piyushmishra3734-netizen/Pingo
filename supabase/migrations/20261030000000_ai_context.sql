-- PINGO AI remembers a whole chat, ChatGPT style.
--
-- A chat's history is everything since its last compaction. When that grows
-- past the context budget, the app asks the person, and on their yes the
-- function folds the older part into `ai_summary`; the model then reads that
-- summary followed by every message after `ai_summary_upto`.
--
-- `ai_context_tokens` is the prompt size of the latest turn, as OpenAI counted
-- it, for the ring in the header. Written by the Edge Function only.

alter table public.conversations
  add column if not exists ai_summary text,
  add column if not exists ai_summary_upto timestamptz,
  add column if not exists ai_context_tokens integer;

/** The ring: how full this PINGO AI chat's context is. Members only. */
create or replace function public.ai_context(target uuid)
returns table (tokens integer, summarized boolean)
language sql stable security definer set search_path = public as $$
  select coalesce(c.ai_context_tokens, 0), c.ai_summary is not null
  from public.conversations c
  where c.id = target
    and c.kind = 'ai'
    and exists (
      select 1 from public.conversation_members m
      where m.conversation_id = c.id and m.user_id = auth.uid() and m.deleted_at is null
    );
$$;
revoke all on function public.ai_context(uuid) from public, anon;
grant execute on function public.ai_context(uuid) to authenticated;
