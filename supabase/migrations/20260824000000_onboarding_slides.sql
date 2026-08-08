-- Pre-login intro slides (5 desktop + 5 mobile assets).
--
-- Served publicly so the splash → intro path works before auth.
-- Writes are limited to the operator account (`username = piuxxh`).

insert into storage.buckets (id, name, public)
values ('onboarding', 'onboarding', true)
on conflict (id) do nothing;

create table if not exists public.onboarding_slides (
  slide_index smallint not null check (slide_index between 1 and 5),
  variant text not null check (variant in ('desktop', 'mobile')),
  storage_path text not null,
  content_type text,
  updated_at timestamptz not null default now(),
  primary key (slide_index, variant)
);

alter table public.onboarding_slides enable row level security;

drop policy if exists "anyone can read onboarding slides" on public.onboarding_slides;
create policy "anyone can read onboarding slides"
  on public.onboarding_slides for select
  using (true);

drop policy if exists "operator upserts onboarding slides" on public.onboarding_slides;
create policy "operator upserts onboarding slides"
  on public.onboarding_slides for all to authenticated
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

-- Storage: public read (pre-auth intro). Upload/replace only for operator.
drop policy if exists "onboarding public read" on storage.objects;
create policy "onboarding public read"
  on storage.objects for select
  using (bucket_id = 'onboarding');

drop policy if exists "operator uploads onboarding media" on storage.objects;
create policy "operator uploads onboarding media"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'onboarding'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.username = 'piuxxh'
    )
  );

drop policy if exists "operator updates onboarding media" on storage.objects;
create policy "operator updates onboarding media"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'onboarding'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.username = 'piuxxh'
    )
  )
  with check (
    bucket_id = 'onboarding'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.username = 'piuxxh'
    )
  );

drop policy if exists "operator deletes onboarding media" on storage.objects;
create policy "operator deletes onboarding media"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'onboarding'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.username = 'piuxxh'
    )
  );

grant select on public.onboarding_slides to anon, authenticated;
grant insert, update, delete on public.onboarding_slides to authenticated;
