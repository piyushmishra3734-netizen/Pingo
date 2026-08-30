-- The operator's "there is a new version" card.
--
-- One image and one build number. Anybody running a build older than that
-- number sees the image when they open the app; everybody else never learns
-- the table exists. Same public `onboarding` bucket and same piuxxh-only write
-- as the splash and intro art.

create table if not exists public.update_notice (
  -- Exactly one row, forever. `id` can only ever be true, so a second insert
  -- collides with the primary key instead of quietly creating a second notice
  -- that nothing would know how to choose between.
  id boolean primary key default true check (id),
  storage_path text not null,
  content_type text,
  -- Android versionCode (YYWWBB). A device showing a smaller number is behind.
  -- Compared as an integer rather than parsing the dotted versionName, which
  -- is the same fact without a parser to get wrong.
  min_build integer not null,
  updated_at timestamptz not null default now()
);

alter table public.update_notice enable row level security;

drop policy if exists "anyone can read the update notice" on public.update_notice;
create policy "anyone can read the update notice"
  on public.update_notice for select
  using (true);

drop policy if exists "operator writes the update notice" on public.update_notice;
create policy "operator writes the update notice"
  on public.update_notice for all to authenticated
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

-- Read by signed-out devices too: somebody on an old build who has been logged
-- out still needs to be told there is a newer one.
grant select on public.update_notice to anon, authenticated;
grant insert, update, delete on public.update_notice to authenticated;

-- The project's default privileges hand anon insert/update/delete on every new
-- public table; RLS is what actually stops it, and here no anon policy exists.
-- Revoked anyway, so the table does not depend on a policy staying correct.
revoke insert, update, delete on public.update_notice from anon;
