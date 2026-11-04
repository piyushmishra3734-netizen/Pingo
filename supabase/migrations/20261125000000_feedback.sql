-- Wishes and feedback: somewhere for a person to tell the operator what to build
-- and what to fix.
--
-- Until now the only route was an email address on the Help screen, which is
-- a route most people never take. This is a text box inside the app.
--
-- ## What it stores
--
-- The person's words, a kind (wish / fix / love / other), the app version and
-- whether it was the Android app or the web. Nothing from their chats and no
-- device identifiers; the screen says exactly this.
--
-- ## Who can do what
--
-- * A person sends through `feedback_send`, which is rate-limited (a handful a
--   day) so a form cannot become a hose, and reads only their own rows.
-- * The operator reads everything and sets a status, through two functions
--   that check `is_operator()`. The status is what a person sees next to
--   their own wish ("Planned", "Done"), so sending one is not shouting into
--   a void.
-- * The table is NOT in the realtime publication. Nobody needs a live feed of
--   feedback, and every table in that publication is egress.

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('wish', 'fix', 'love', 'other')),
  body text not null check (char_length(body) between 3 and 2000),
  app_version text check (app_version is null or char_length(app_version) <= 40),
  platform text check (platform is null or platform in ('android', 'web')),
  status text not null default 'new' check (status in ('new', 'seen', 'planned', 'done', 'declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists feedback_user_created_idx on public.feedback (user_id, created_at desc);
create index if not exists feedback_status_created_idx on public.feedback (status, created_at desc);

alter table public.feedback enable row level security;

-- Reading your own, only. Every write goes through the functions below.
revoke all on public.feedback from public, anon, authenticated;
grant select on public.feedback to authenticated;

drop policy if exists "read own feedback" on public.feedback;
create policy "read own feedback" on public.feedback
  for select to authenticated
  using (user_id = auth.uid());

-- Sending. Five a day and no repeating yourself word for word.
create or replace function public.feedback_send(
  p_kind text,
  p_body text,
  p_app_version text default null,
  p_platform text default null
)
returns public.feedback
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  clean text := btrim(coalesce(p_body, ''));
  row public.feedback;
begin
  if me is null then
    raise exception 'Sign in to send feedback.';
  end if;
  if p_kind not in ('wish', 'fix', 'love', 'other') then
    raise exception 'Pick what kind of message this is.';
  end if;
  if char_length(clean) < 3 then
    raise exception 'Write a little more, then send.';
  end if;
  if char_length(clean) > 2000 then
    raise exception 'That is over 2000 characters. Please shorten it.';
  end if;
  if (select count(*) from public.feedback f
       where f.user_id = me and f.created_at > now() - interval '1 day') >= 5 then
    raise exception 'You have sent a few today already. Try again tomorrow.';
  end if;
  if exists (select 1 from public.feedback f
              where f.user_id = me and f.body = clean and f.created_at > now() - interval '1 day') then
    raise exception 'You already sent this one.';
  end if;

  insert into public.feedback (user_id, kind, body, app_version, platform)
  values (
    me, p_kind, clean,
    left(p_app_version, 40),
    case when p_platform in ('android', 'web') then p_platform else null end
  )
  returning * into row;

  return row;
end;
$$;

revoke execute on function public.feedback_send(text, text, text, text) from public, anon;
grant execute on function public.feedback_send(text, text, text, text) to authenticated;

-- The operator's inbox. Names, not accounts to browse: just who wrote it.
create or replace function public.operator_feedback(p_status text default null)
returns table (
  id uuid,
  user_id uuid,
  username text,
  display_name text,
  kind text,
  body text,
  app_version text,
  platform text,
  status text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_operator() then
    raise exception 'Only the operator can read feedback.';
  end if;

  return query
    select f.id, f.user_id, p.username, p.display_name, f.kind, f.body,
           f.app_version, f.platform, f.status, f.created_at
      from public.feedback f
      left join public.profiles p on p.id = f.user_id
     where p_status is null
        or f.status = p_status
        or (p_status = 'open' and f.status in ('new', 'seen'))
     order by f.created_at desc
     limit 200;
end;
$$;

revoke execute on function public.operator_feedback(text) from public, anon;
grant execute on function public.operator_feedback(text) to authenticated;

create or replace function public.operator_feedback_set(p_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_operator() then
    raise exception 'Only the operator can update feedback.';
  end if;
  if p_status not in ('new', 'seen', 'planned', 'done', 'declined') then
    raise exception 'Unknown status.';
  end if;
  update public.feedback set status = p_status, updated_at = now() where id = p_id;
end;
$$;

revoke execute on function public.operator_feedback_set(uuid, text) from public, anon;
grant execute on function public.operator_feedback_set(uuid, text) to authenticated;
