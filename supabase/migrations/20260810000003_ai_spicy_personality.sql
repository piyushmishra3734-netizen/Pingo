-- Add Spicy personality option for PINGO AI.

alter table public.ai_profiles drop constraint if exists ai_profiles_personality;
alter table public.ai_profiles
  add constraint ai_profiles_personality check (
    personality in (
      'friendly', 'genz', 'coach', 'study', 'calm',
      'funny', 'motivator', 'creative', 'spicy', 'custom'
    )
  );
