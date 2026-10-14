-- Thumbs up / down on PINGO AI replies, one per person per reply.
-- Only on a reply in a conversation they are a member of; only their own row.
create table if not exists public.ai_feedback (
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  rating smallint not null check (rating in (-1, 1)),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

alter table public.ai_feedback enable row level security;

drop policy if exists "own ai feedback read" on public.ai_feedback;
create policy "own ai feedback read" on public.ai_feedback
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "own ai feedback write" on public.ai_feedback;
create policy "own ai feedback write" on public.ai_feedback
  for insert to authenticated with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.messages m
      join public.conversation_members cm on cm.conversation_id = m.conversation_id
      where m.id = message_id and cm.user_id = auth.uid() and m.sender_id = public.pingo_ai_user_id()
    )
  );

drop policy if exists "own ai feedback change" on public.ai_feedback;
create policy "own ai feedback change" on public.ai_feedback
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "own ai feedback delete" on public.ai_feedback;
create policy "own ai feedback delete" on public.ai_feedback
  for delete to authenticated using (user_id = auth.uid());

-- New tables get no grants in this project; RLS above still scopes the rows.
grant select, insert, update, delete on public.ai_feedback to authenticated;
