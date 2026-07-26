-- Message reactions.
--
-- Blocking work on docs/13 § 3: the reaction bar cannot be built honestly on
-- top of a `toggleReaction` that stores nothing — the emoji would appear and be
-- gone on reload.
--
-- ## One row per person per message
--
-- Not per emoji. Reacting again replaces what you had rather than adding to it,
-- which is what every messenger that matters does: a reaction is an opinion,
-- and people have one at a time. The primary key enforces it, so the client
-- cannot get this wrong even by accident.

create table if not exists public.message_reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create index if not exists message_reactions_message_idx
  on public.message_reactions (message_id);

alter table public.message_reactions enable row level security;

/*
 * Membership is the whole access rule, and `is_conversation_member` already
 * answers it for `auth.uid()` only — so it cannot be used to read into a
 * conversation the caller is not in.
 */
drop policy if exists "read reactions in my conversations" on public.message_reactions;
create policy "read reactions in my conversations"
  on public.message_reactions for select to authenticated
  using (
    exists (
      select 1 from public.messages m
      where m.id = message_id and public.is_conversation_member(m.conversation_id)
    )
  );

-- You may only ever write your own, and only where you can already read.
drop policy if exists "react as myself" on public.message_reactions;
create policy "react as myself"
  on public.message_reactions for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.messages m
      where m.id = message_id and public.is_conversation_member(m.conversation_id)
    )
  );

drop policy if exists "change my own reaction" on public.message_reactions;
create policy "change my own reaction"
  on public.message_reactions for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "remove my own reaction" on public.message_reactions;
create policy "remove my own reaction"
  on public.message_reactions for delete to authenticated
  using (user_id = auth.uid());

-- Live, like messages. Without this the other person's reaction only appears on
-- reload, which for a gesture this immediate reads as it not having worked.
do $$
begin
  alter publication supabase_realtime add table public.message_reactions;
exception
  when duplicate_object then null;
end;
$$;

alter table public.message_reactions replica identity full;

/*
 * Toggle in one statement.
 *
 * Tapping the emoji you already chose removes it; tapping a different one
 * replaces it. Doing this as read-then-write in the client would let two quick
 * taps race and leave the wrong emoji standing.
 */
create or replace function public.toggle_reaction(target uuid, symbol text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  existing text;
  conv uuid;
begin
  select conversation_id into conv from public.messages where id = target;
  if conv is null or not public.is_conversation_member(conv) then
    return;
  end if;

  select emoji into existing
  from public.message_reactions
  where message_id = target and user_id = auth.uid();

  if existing = symbol then
    delete from public.message_reactions
    where message_id = target and user_id = auth.uid();
  else
    insert into public.message_reactions (message_id, user_id, emoji)
    values (target, auth.uid(), symbol)
    on conflict (message_id, user_id) do update set emoji = symbol, created_at = now();
  end if;
end;
$$;

revoke all on function public.toggle_reaction(uuid, text) from public;
grant execute on function public.toggle_reaction(uuid, text) to authenticated;
