-- PINGO — profiles.
--
-- The first table in the product. It holds *display* identity — the name, the
-- handle, the photo — and nothing else. Credentials stay in `auth.users`, where
-- Supabase manages them; conversations will live behind `ChatService`. Keeping
-- those three apart is what stops this table from quietly becoming the place
-- everything ends up.
--
-- One row per account, keyed on the auth user, deleted with it.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,

  -- Stored lowercase, always. docs/01 § 9.2: "Lowercase-normalised as you type,
  -- so the user is never corrected afterwards." Because the stored form is
  -- already canonical, a plain unique index gives case-insensitive uniqueness
  -- without needing citext.
  username text not null,

  -- Required. docs/01 § 9.2: "A nameless account is unusable for everyone who
  -- talks to it." Real names are not required — only *a* name.
  display_name text not null,

  -- Null means the monogram, which § 9.1 treats as a real default rather than
  -- an empty slot.
  avatar_url text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint profiles_username_format
    check (username = lower(username) and username ~ '^[a-z0-9_]{3,20}$'),

  constraint profiles_display_name_length
    check (char_length(display_name) between 1 and 50)
);

create unique index if not exists profiles_username_key on public.profiles (username);

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
--
-- Read is open to any signed-in user, and that is a deliberate decision rather
-- than laziness: a username is a public handle. It has to be readable to answer
-- "is this taken?" on the sign-up screen, and to render the name and photo of
-- anyone you are talking to. Nothing private lives in this table — no email, no
-- phone number, no last-seen.
--
-- Write is restricted to the row's owner, so no one can rename or re-photograph
-- somebody else.

alter table public.profiles enable row level security;

drop policy if exists "profiles are readable by signed-in users" on public.profiles;
create policy "profiles are readable by signed-in users"
  on public.profiles for select
  to authenticated
  using (true);

drop policy if exists "users create their own profile" on public.profiles;
create policy "users create their own profile"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

drop policy if exists "users update their own profile" on public.profiles;
create policy "users update their own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- ---------------------------------------------------------------------------
-- Avatar storage
-- ---------------------------------------------------------------------------
--
-- Public bucket: avatars are shown to anyone you converse with, and a signed
-- URL per render would be a request per avatar per screen.
--
-- Objects are namespaced by user id (`<uid>/<file>`), which is what makes the
-- write policies below enforceable — a user may only write inside their own
-- folder.

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "avatars are publicly readable" on storage.objects;
create policy "avatars are publicly readable"
  on storage.objects for select
  using (bucket_id = 'avatars');

drop policy if exists "users upload their own avatar" on storage.objects;
create policy "users upload their own avatar"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "users replace their own avatar" on storage.objects;
create policy "users replace their own avatar"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "users delete their own avatar" on storage.objects;
create policy "users delete their own avatar"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
