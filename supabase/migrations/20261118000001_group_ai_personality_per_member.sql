-- PINGO AI's personality in a group is each member's own, not the group's.
--
-- `@pingoai /personality` opens a card; what somebody picks there is how PINGO
-- AI talks *to them* in that group, whenever they tag it. Everybody else keeps
-- their own. So it lives on the member's row, and anyone may set their own -
-- except Spicy, which needs 18+ by their PINGO AI age.
--
-- Replaces the group-wide `conversations.ai_personality` from
-- 20261118000000; `set_group_ai_personality` now sets the caller's own, so a
-- build that still calls it changes only them. The old column is dropped once
-- the function no longer reads it (20261118000002).

alter table public.conversation_members add column if not exists ai_personality text;

alter table public.conversation_members drop constraint if exists conversation_members_ai_personality;
alter table public.conversation_members
  add constraint conversation_members_ai_personality check (
    ai_personality is null or ai_personality in (
      'professional', 'creative', 'concise', 'funny', 'genz', 'coach',
      'study', 'calm', 'motivator', 'spicy'
    )
  );

grant select (ai_personality) on public.conversation_members to authenticated;

create or replace function public.set_my_group_ai_personality(target uuid, new_personality text)
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
    where conversation_id = target and user_id = 'a1000000-0000-4000-8000-0000000000a1'
  ) then
    raise exception 'PINGO AI is not in this group.' using errcode = '22023';
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

  if wanted = 'spicy' then
    select age into my_age from public.ai_profiles where user_id = me;
    if my_age is null or my_age < 18 then
      raise exception 'adults_only' using errcode = '42501';
    end if;
  end if;

  update public.conversation_members
  set ai_personality = wanted
  where conversation_id = target and user_id = me;
  if not found then
    raise exception 'Not a member of this group.' using errcode = '42501';
  end if;
  return coalesce(wanted, 'friendly');
end;
$$;

revoke all on function public.set_my_group_ai_personality(uuid, text) from public, anon;
grant execute on function public.set_my_group_ai_personality(uuid, text) to authenticated;

-- The group-wide setter, kept for builds that still call it: it now sets only the caller's own.
create or replace function public.set_group_ai_personality(target uuid, new_personality text)
returns text
language sql
security definer
set search_path = public
as $$
  select public.set_my_group_ai_personality(target, new_personality);
$$;

update public.conversations set ai_personality = null where ai_personality is not null;
