-- PINGO AI's profile page: who it is to this person, how it sounds on a call,
-- and the personalities the page offers.
--
-- Everything stays on the person's own `ai_profiles` row (RLS: their row only),
-- so the chat function and the call function read it the way they already do.

alter table public.ai_profiles
  add column if not exists tagline text,
  add column if not exists status text not null default 'online',
  add column if not exists custom_instructions text,
  add column if not exists voice text,
  add column if not exists voice_speed numeric(3, 2) not null default 1,
  add column if not exists voice_language text;

alter table public.ai_profiles drop constraint if exists ai_profiles_tagline_len;
alter table public.ai_profiles
  add constraint ai_profiles_tagline_len check (tagline is null or char_length(tagline) <= 50);

alter table public.ai_profiles drop constraint if exists ai_profiles_status;
alter table public.ai_profiles
  add constraint ai_profiles_status check (status in ('online', 'away', 'dnd'));

alter table public.ai_profiles drop constraint if exists ai_profiles_custom_instructions_len;
alter table public.ai_profiles
  add constraint ai_profiles_custom_instructions_len check (custom_instructions is null or char_length(custom_instructions) <= 500);

-- OpenAI's realtime voices; anything else would fail the call at start.
alter table public.ai_profiles drop constraint if exists ai_profiles_voice;
alter table public.ai_profiles
  add constraint ai_profiles_voice check (
    voice is null or voice in ('marin', 'cedar', 'alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse')
  );

-- The realtime API takes 0.25 to 1.5; the page offers the part that still sounds natural.
alter table public.ai_profiles drop constraint if exists ai_profiles_voice_speed;
alter table public.ai_profiles
  add constraint ai_profiles_voice_speed check (voice_speed between 0.7 and 1.3);

-- The page allows a 200 character bio (was 160).
alter table public.ai_profiles drop constraint if exists ai_profiles_bio_len;
alter table public.ai_profiles
  add constraint ai_profiles_bio_len check (bio is null or char_length(bio) <= 200);

-- Two new personalities: professional and concise. The older ones stay valid for rows that hold them.
alter table public.ai_profiles drop constraint if exists ai_profiles_personality;
alter table public.ai_profiles
  add constraint ai_profiles_personality check (
    personality in (
      'friendly', 'professional', 'creative', 'concise', 'funny', 'custom',
      'genz', 'coach', 'study', 'calm', 'motivator', 'spicy'
    )
  );

/*
 * Pro avatars are premium. The page hides them from everyone else, but the row
 * is the person's own and the API would take any URL, so the rule lives here
 * too: a Pro avatar needs `profiles.is_premium`, which only the operator sets.
 */
create or replace function public.ai_profiles_pro_avatar_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  /*
   * Only a change of face is checked. An upsert runs this as an INSERT even
   * when the row exists, so "changed" is read from the stored row, not `old`:
   * somebody whose premium lapsed keeps the face they have and can still save
   * everything else.
   */
  if new.avatar_url in ('/ai/avatars/headset.webp', '/ai/avatars/wizard.webp', '/ai/avatars/explorer.webp')
     and (select a.avatar_url from public.ai_profiles a where a.user_id = new.user_id) is distinct from new.avatar_url
     and not coalesce((select p.is_premium from public.profiles p where p.id = new.user_id), false) then
    raise exception 'That avatar is part of Pingo Pro.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists ai_profiles_pro_avatar on public.ai_profiles;
create trigger ai_profiles_pro_avatar
  before insert or update of avatar_url on public.ai_profiles
  for each row execute function public.ai_profiles_pro_avatar_guard();
