-- Per-user banner/cover for the AI person card.

alter table public.ai_profiles
  add column if not exists banner_url text;
