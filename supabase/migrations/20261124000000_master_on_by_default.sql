-- PINGO Master is on for everybody by default, free accounts included.
--
-- It was never premium (only pictures are), but it started switched off and each
-- person had to find the switch. Nothing it does changes: every message and every
-- setting is still a task the person approves first, and the switch in PINGO AI's
-- settings still turns it off.
--
-- Done with rows, not by rewriting the gate: `master_check`, `master_find_chat`
-- and the ai-chat function all read `ai_master_settings`, so giving everybody a
-- row with `enabled = true` changes them all at once and leaves their code alone.
--   1. the column default is on, so a row made by anything else starts on;
--   2. everybody without a row gets one (nobody had switched it off: a person who
--      does so later keeps their choice, because their row already exists);
--   3. a new profile gets its row the moment it is made.

alter table public.ai_master_settings alter column enabled set default true;

insert into public.ai_master_settings (user_id)
select p.id from public.profiles p
on conflict (user_id) do nothing;

create or replace function public.master_default_row()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.ai_master_settings (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;
revoke all on function public.master_default_row() from public, anon, authenticated;

drop trigger if exists profiles_master_default on public.profiles;
create trigger profiles_master_default
  after insert on public.profiles
  for each row execute function public.master_default_row();
