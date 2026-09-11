-- PINGO Live: Instagram-style live video.
--
-- One host broadcasts over LiveKit (room `live_<id>`), everyone mutual watches,
-- comments and sends hearts. The signalling rows live here; the media never
-- touches Postgres.
--
-- ## Visibility follows stories
--
-- Stories are mutual-only (`is_mutual`), so a live is too: your followers who
-- follow you back see it and get notified. Strangers cannot list it, read it,
-- or mint a viewer token for it.
--
-- ## Notifications fan out from a trigger
--
-- The host's app can be backgrounded the moment they go live, so the fanout is
-- not client code: `on_live_started` writes one `notifications` row per mutual
-- follower through `notify_user`, and the existing `notifications_push` trigger
-- delivers them (push + in-app feed) like any other kind.
--
-- ## Hearts are ephemeral
--
-- A heart is a broadcast moment, not a row. The total is a counter on the live
-- row so the end-of-live summary can say it. Comments persist (they are how a
-- viewer asks a question the host answers on camera).

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.live_streams (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'live' check (status in ('live', 'ended')),
  title text not null default '',
  viewer_count integer not null default 0,
  peak_viewers integer not null default 0,
  total_joins integer not null default 0,
  likes_count integer not null default 0,
  -- The shared hearts goal (TikTok LIVE goals, minus the coins). The host
  -- sets a target with a reward note; every screen draws the same bar from
  -- these two columns, and crossing it celebrates on all of them at once.
  goal_target integer,
  goal_title text not null default '',
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists live_streams_live_idx
  on public.live_streams (status, started_at desc)
  where status = 'live';

create index if not exists live_streams_host_idx
  on public.live_streams (host_id, started_at desc);

create table if not exists public.live_comments (
  id uuid primary key default gen_random_uuid(),
  live_id uuid not null references public.live_streams (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);

create index if not exists live_comments_live_idx
  on public.live_comments (live_id, created_at asc);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.live_streams enable row level security;
alter table public.live_comments enable row level security;

-- A live is visible to mutuals and to its host (who also needs their own
-- ended rows for the end-of-live summary).
drop policy if exists "live streams are visible to mutuals" on public.live_streams;
create policy "live streams are visible to mutuals"
  on public.live_streams for select to authenticated
  using (
    host_id = auth.uid()
    or (status = 'live' and public.is_mutual(host_id))
  );

-- Starting a live is stating your own id. Nothing else is writable.
drop policy if exists "hosts start their own live" on public.live_streams;
create policy "hosts start their own live"
  on public.live_streams for insert to authenticated
  with check (host_id = auth.uid() and status = 'live');

-- Ending it, updating counters. Counters are host-written from the broadcast
-- channel state; a viewer client never writes here.
drop policy if exists "hosts update their own live" on public.live_streams;
create policy "hosts update their own live"
  on public.live_streams for update to authenticated
  using (host_id = auth.uid())
  with check (host_id = auth.uid());

drop policy if exists "hosts delete their own live" on public.live_streams;
create policy "hosts delete their own live"
  on public.live_streams for delete to authenticated
  using (host_id = auth.uid());

-- Comments are readable by anyone who can see the live.
drop policy if exists "live comments are visible with the live" on public.live_comments;
create policy "live comments are visible with the live"
  on public.live_comments for select to authenticated
  using (
    exists (
      select 1 from public.live_streams s
      where s.id = live_id
        and (s.host_id = auth.uid() or (s.status = 'live' and public.is_mutual(s.host_id)))
    )
  );

-- Any signed-in viewer of a live live may comment. The host included.
drop policy if exists "viewers comment on live lives" on public.live_comments;
create policy "viewers comment on live lives"
  on public.live_comments for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.live_streams s
      where s.id = live_id
        and s.status = 'live'
        and (s.host_id = auth.uid() or public.is_mutual(s.host_id))
    )
  );

-- ---------------------------------------------------------------------------
-- Notifications: 'live' joins the kind list, then the fanout
-- ---------------------------------------------------------------------------

alter table public.notifications
  drop constraint if exists notifications_kind_check;

alter table public.notifications
  add constraint notifications_kind_check
    check (
      kind in (
        'follow_request',
        'follow_accepted',
        'message',
        'voice',
        'snap',
        'ping_opened',
        'ping_replayed',
        'story',
        'story_reply',
        'call',
        'mention',
        'like',
        'comment',
        'ai',
        'journey',
        'marketing',
        'new_device',
        -- Someone you follow started a live video.
        'live'
      )
    );

-- `push_allowed` treats unknown kinds as allowed, so 'live' already passes.
-- Social opt-out covers it too: a mute for social silences lives as well.
-- Kept explicit so the next reader does not have to re-derive it.
create or replace function public.push_allowed(target uuid, event_kind text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  p public.notification_prefs%rowtype;
  local_minute integer;
begin
  select * into p from public.notification_prefs where user_id = target;

  if not found then
    return true;
  end if;

  if p.muted then
    return false;
  end if;

  if event_kind = 'message' and not p.messages then return false; end if;
  if event_kind = 'snap' and not p.messages then return false; end if;
  if event_kind = 'story' and not p.social then return false; end if;
  if event_kind = 'live' and not p.social then return false; end if;
  if event_kind in ('follow_request', 'follow_accepted') and not p.social then
    return false;
  end if;

  if p.quiet_enabled then
    local_minute := (extract(hour from (now() at time zone 'utc') + make_interval(mins => p.utc_offset_minutes)) * 60
                   + extract(minute from (now() at time zone 'utc') + make_interval(mins => p.utc_offset_minutes)))::integer;

    if p.quiet_start_minute > p.quiet_end_minute then
      if local_minute >= p.quiet_start_minute or local_minute < p.quiet_end_minute then
        return false;
      end if;
    else
      if local_minute >= p.quiet_start_minute and local_minute < p.quiet_end_minute then
        return false;
      end if;
    end if;
  end if;

  return true;
end;
$$;

/*
 * One notification per mutual follower when a live starts.
 *
 * Mutual, not every follower: the live itself is only visible to mutuals, and
 * a notification pointing at something the recipient cannot open is worse than
 * none. `notify_user` never raises, so a large follower list cannot fail the
 * insert that caused it.
 */
create or replace function public.on_live_started()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  follower record;
begin
  if new.status <> 'live' then
    return new;
  end if;

  for follower in
    select f.follower_id
    from public.follows f
    where f.followee_id = new.host_id
      and f.status = 'accepted'
      and exists (
        select 1 from public.follows back
        where back.follower_id = new.host_id
          and back.followee_id = f.follower_id
          and back.status = 'accepted'
      )
  loop
    perform public.notify_user(follower.follower_id, new.host_id, 'live', new.id);
  end loop;

  return new;
end;
$$;

drop trigger if exists live_streams_notify on public.live_streams;
create trigger live_streams_notify
  after insert on public.live_streams
  for each row execute function public.on_live_started();

-- ---------------------------------------------------------------------------
-- Realtime: the rail, the viewer count and the comments all arrive live
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['live_streams', 'live_comments'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then null;
      when undefined_table then null;
    end;
  end loop;
end;
$$;
