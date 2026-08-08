-- Operator-controlled splash artwork (desktop + mobile).
-- Same public `onboarding` bucket + piuxxh-only write pattern as intro slides.

create table if not exists public.app_splash (
  variant text not null check (variant in ('desktop', 'mobile')),
  storage_path text not null,
  content_type text,
  updated_at timestamptz not null default now(),
  primary key (variant)
);

alter table public.app_splash enable row level security;

drop policy if exists "anyone can read app splash" on public.app_splash;
create policy "anyone can read app splash"
  on public.app_splash for select
  using (true);

drop policy if exists "operator upserts app splash" on public.app_splash;
create policy "operator upserts app splash"
  on public.app_splash for all to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.username = 'piuxxh'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.username = 'piuxxh'
    )
  );

grant select on public.app_splash to anon, authenticated;
grant insert, update, delete on public.app_splash to authenticated;
