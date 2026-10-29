-- PINGO AI: "tell me about you" until answered or skipped, and a personality per group.
--
-- `about_done_at` is when somebody finished or skipped the interests / life /
-- what-you-want steps. Until it is set, opening PINGO AI's chat asks again, so
-- the people who set PINGO AI up before those steps existed get them too.
-- Anyone who already has those answers counts as done.
--
-- `conversations.ai_personality` is how PINGO AI talks in one group, set with
-- `/personality <name>` in that group. Only an adult (18+ by their PINGO AI age)
-- may change it - any personality, since one of them is Spicy - and Spicy is
-- still only spoken to adults: the function answers anyone younger in the
-- default voice (`profile-prompt.ts`, `spicy.ts`).

alter table public.ai_profiles add column if not exists about_done_at timestamptz;

update public.ai_profiles p
set about_done_at = now()
where p.about_done_at is null
  and exists (
    select 1 from public.ai_memories m
    where m.user_id = p.user_id and m.key like 'onboarding\_%'
  );

alter table public.conversations add column if not exists ai_personality text;

alter table public.conversations drop constraint if exists conversations_ai_personality;
alter table public.conversations
  add constraint conversations_ai_personality check (
    ai_personality is null or ai_personality in (
      'professional', 'creative', 'concise', 'funny', 'genz', 'coach',
      'study', 'calm', 'motivator', 'spicy'
    )
  );

-- Readable like the rest of the row, where columns are granted one by one.
grant select (ai_personality) on public.conversations to authenticated;

create or replace function public.set_group_ai_personality(target uuid, new_personality text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  my_age int;
  wanted text := lower(trim(coalesce(new_personality, '')));
begin
  if me is null then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.conversations c
    where c.id = target and c.kind in ('group', 'community')
  ) then
    raise exception 'Only a group has its own PINGO AI personality.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.conversation_members
    where conversation_id = target and user_id = me
  ) then
    raise exception 'Not a member of this group.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.conversation_members
    where conversation_id = target and user_id = 'a1000000-0000-4000-8000-0000000000a1'
  ) then
    raise exception 'PINGO AI is not in this group.' using errcode = '22023';
  end if;

  select age into my_age from public.ai_profiles where user_id = me;
  if my_age is null or my_age < 18 then
    raise exception 'adults_only' using errcode = '42501';
  end if;

  if wanted in ('', 'default', 'friendly') then
    wanted := null;
  elsif wanted = 'fun' then
    wanted := 'funny';
  elsif wanted not in (
    'professional', 'creative', 'concise', 'funny', 'genz', 'coach',
    'study', 'calm', 'motivator', 'spicy'
  ) then
    raise exception 'unknown_personality' using errcode = '22023';
  end if;

  update public.conversations set ai_personality = wanted where id = target;
  return coalesce(wanted, 'friendly');
end;
$$;

revoke all on function public.set_group_ai_personality(uuid, text) from public, anon;
grant execute on function public.set_group_ai_personality(uuid, text) to authenticated;
