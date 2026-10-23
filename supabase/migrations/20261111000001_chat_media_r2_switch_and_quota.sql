-- A switch for chat media on R2, and a daily upload budget per person.
--
-- ## The switch
--
-- Chat media on Cloudflare R2 (`20261111000000_visible_chat_media`) is stored as
-- an `r2:` path. A copy of PINGO that predates it cannot read one: it would ask
-- Supabase Storage to sign a path that is not there, and the photo would be
-- broken for whoever has not updated. Web updates itself; an installed Android
-- app does not.
--
-- So whether a copy of PINGO *uploads* chat media to R2 is decided here, not in
-- the build: off for everyone until most people have an app that can read it,
-- then on. Reading never depends on it. `enabled` turns it on for everybody;
-- `user_ids` turns it on for just those accounts, which is how it is tried on
-- real data before anybody else is exposed to it.
--
-- ## The budget
--
-- R2 has no per-bucket limits the way Supabase Storage did, so any signed-in
-- account could otherwise upload without end. The Worker takes each upload's
-- size from this before it stores a byte. Generous for a person (a gigabyte and
-- three hundred files a day), tiny against an abuser.
--
-- Both tables are reachable only through the functions below.

create table if not exists public.app_flags (
  key text primary key,
  enabled boolean not null default false,
  user_ids uuid[] not null default '{}',
  note text
);

alter table public.app_flags enable row level security;
-- No policies on purpose: nobody reads or writes this table directly.

create or replace function public.app_flag(p_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select f.enabled or (auth.uid() is not null and auth.uid() = any (f.user_ids))
      from public.app_flags f
      where f.key = p_key
    ),
    false
  );
$$;

revoke all on function public.app_flag(text) from public, anon;
grant execute on function public.app_flag(text) to authenticated;

insert into public.app_flags (key, enabled, note)
values (
  'chat_media_r2',
  false,
  'Upload chat photos, voice, documents, video and Pings to R2. Turn on for everybody once most installed apps can read r2: paths.'
)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------

create table if not exists public.media_quota (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null default current_date,
  bytes bigint not null default 0,
  files integer not null default 0,
  primary key (user_id, day)
);

alter table public.media_quota enable row level security;
-- No policies: only take_media_quota writes it.

/*
 * Spends part of today's budget. True when the upload may go ahead, false when
 * it would take the person past a gigabyte or three hundred files today.
 * Atomic: two uploads at once cannot both slip under the line.
 */
create or replace function public.take_media_quota(p_bytes bigint)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  max_bytes constant bigint := 1073741824;
  max_files constant integer := 300;
  taken boolean;
begin
  if me is null or p_bytes is null or p_bytes < 0 or p_bytes > max_bytes then
    return false;
  end if;

  with up as (
    insert into public.media_quota as q (user_id, day, bytes, files)
    values (me, current_date, p_bytes, 1)
    on conflict (user_id, day) do update
      set bytes = q.bytes + excluded.bytes,
          files = q.files + 1
      where q.bytes + excluded.bytes <= max_bytes
        and q.files < max_files
    returning 1
  )
  select exists (select 1 from up) into taken;

  -- A week is more than anybody needs to see; keep the table the size of this week.
  delete from public.media_quota where day < current_date - 7 and user_id = me;

  return taken;
end;
$$;

revoke all on function public.take_media_quota(bigint) from public, anon;
grant execute on function public.take_media_quota(bigint) to authenticated;
