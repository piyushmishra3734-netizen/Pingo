-- Per-user bio for how PINGO AI appears to that person.
-- Global default still lives on the bot profile; this overrides it for one user.

alter table public.ai_profiles
  add column if not exists bio text;

alter table public.ai_profiles
  drop constraint if exists ai_profiles_bio_len;

alter table public.ai_profiles
  add constraint ai_profiles_bio_len
  check (bio is null or char_length(bio) <= 160);
