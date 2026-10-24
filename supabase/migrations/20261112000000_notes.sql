-- PINGO Notes: a short line (up to 100 characters), optionally a song and a
-- background, that sits on your circle in the story tray for 24 hours - Instagram's notes, in PINGO's tray.
--
-- One live note per person: writing a new one replaces the old. Who sees it
-- follows the story rule - friends are mutual follows, close friends are the
-- people on your close-friends list - and that rule is applied here, in the
-- function that lists notes, not in the app.
--
-- The table has no policy for anyone but its owner, so the only way to write
-- is `note_set` (which checks the text and the song) and the only way to read
-- other people's notes is `notes_feed` (which checks who may see them).

create table if not exists public.notes (
  user_id uuid primary key references auth.users (id) on delete cascade,
  body text not null default '',
  -- Same few fields the profile song stores; small and object-shaped.
  song jsonb,
  audience text not null default 'friends',
  -- One of a few fixed looks for the bubble; the app owns what each one is.
  bg text not null default 'default',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  constraint notes_audience check (audience in ('friends', 'close')),
  constraint notes_body_length check (char_length(body) <= 100),
  constraint notes_bg check (bg in ('default', 'rose', 'ocean', 'forest', 'amber', 'violet')),
  constraint notes_song_shape check (
    song is null
    or (jsonb_typeof(song) = 'object' and octet_length(song::text) <= 2048)
  ),
  constraint notes_not_empty check (char_length(btrim(body)) > 0 or song is not null)
);

alter table public.notes enable row level security;

drop policy if exists "see my own note" on public.notes;
create policy "see my own note"
  on public.notes for select to authenticated
  using (user_id = auth.uid());

revoke all on public.notes from anon, authenticated;
grant select on public.notes to authenticated;

create or replace function public.note_set(
  p_body text,
  p_song jsonb,
  p_audience text default 'friends',
  p_bg text default 'default'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  clean text := btrim(coalesce(p_body, ''));
begin
  if me is null then
    raise exception 'sign in first' using errcode = '28000';
  end if;
  if p_audience not in ('friends', 'close') then
    raise exception 'bad audience' using errcode = '22023';
  end if;
  if coalesce(p_bg, 'default') not in ('default', 'rose', 'ocean', 'forest', 'amber', 'violet') then
    raise exception 'bad background' using errcode = '22023';
  end if;
  if char_length(clean) > 100 then
    raise exception 'a note is at most 100 characters' using errcode = '22023';
  end if;
  if clean = '' and p_song is null then
    raise exception 'a note needs words or a song' using errcode = '22023';
  end if;
  if p_song is not null and (jsonb_typeof(p_song) <> 'object' or octet_length(p_song::text) > 2048) then
    raise exception 'bad song' using errcode = '22023';
  end if;

  insert into public.notes (user_id, body, song, audience, bg, created_at, expires_at)
  values (me, clean, p_song, p_audience, coalesce(p_bg, 'default'), now(), now() + interval '24 hours')
  on conflict (user_id) do update
    set body = excluded.body,
        song = excluded.song,
        audience = excluded.audience,
        bg = excluded.bg,
        created_at = excluded.created_at,
        expires_at = excluded.expires_at;
end;
$$;

create or replace function public.note_clear()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.notes where user_id = auth.uid();
$$;

create or replace function public.notes_feed()
returns table (
  user_id uuid,
  username text,
  display_name text,
  avatar_url text,
  body text,
  song jsonb,
  audience text,
  bg text,
  created_at timestamptz,
  expires_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select n.user_id, p.username, p.display_name, p.avatar_url,
         n.body, n.song, n.audience, n.bg, n.created_at, n.expires_at
  from public.notes n
  join public.profiles p on p.id = n.user_id
  where auth.uid() is not null
    and n.expires_at > now()
    and n.user_id <> auth.uid()
    and (
      (n.audience = 'friends' and public.is_mutual(n.user_id))
      or (
        n.audience = 'close'
        and exists (
          select 1 from public.close_friends cf
          where cf.owner_id = n.user_id and cf.friend_id = auth.uid()
        )
      )
    )
  order by n.created_at desc
  limit 100;
$$;

revoke all on function public.note_set(text, jsonb, text, text) from public, anon;
revoke all on function public.note_clear() from public, anon;
revoke all on function public.notes_feed() from public, anon;
grant execute on function public.note_set(text, jsonb, text, text) to authenticated;
grant execute on function public.note_clear() to authenticated;
grant execute on function public.notes_feed() to authenticated;

-- Expired notes are never listed; this only tidies the table.
create or replace function public.notes_sweep()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.notes where expires_at < now() - interval '1 day';
$$;
revoke all on function public.notes_sweep() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'notes-sweep';
    perform cron.schedule('notes-sweep', '17 * * * *', 'select public.notes_sweep()');
  end if;
end $$;
