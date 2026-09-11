-- PINGO Live guests: one co-host on screen with the host.
--
-- Instagram Rooms and TikTok multi-guest both work the same way: a viewer asks
-- (or the host invites), the host approves, and the broadcast becomes a split
-- screen. The row here is the handshake; the media rides LiveKit once the
-- `live-token` function sees an approved row and mints a publishing grant.
--
-- Statuses:
--   requested  viewer asked to join; host has not answered
--   invited    host asked this viewer; viewer has not answered
--   joined     publishing right now (at most one per live in v1)
--   declined / left / removed  terminal; kept so re-requests read sensibly

create table if not exists public.live_guests (
  live_id uuid not null references public.live_streams (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'requested'
    check (status in ('requested', 'invited', 'joined', 'declined', 'left', 'removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (live_id, user_id)
);

create index if not exists live_guests_live_idx
  on public.live_guests (live_id, status);

-- The pinned comment, owned by the host. Broadcast carries the moment;
-- this column carries the truth a late joiner reads.
alter table public.live_streams
  add column if not exists pinned_comment jsonb;

alter table public.live_guests enable row level security;

-- Same coarse gate as the streams tables (see 20260965000000).
grant select, insert, update, delete on public.live_guests to anon, authenticated;

-- Anyone who can see the live can see who is on it.
drop policy if exists "guests visible with the live" on public.live_guests;
create policy "guests visible with the live"
  on public.live_guests for select to authenticated
  using (
    exists (
      select 1 from public.live_streams s
      where s.id = live_id
        and (s.host_id = auth.uid() or (s.status = 'live' and public.is_mutual(s.host_id)))
    )
  );

-- A viewer may ask once: their own row, requested, on somebody else's live.
drop policy if exists "viewers request to join" on public.live_guests;
create policy "viewers request to join"
  on public.live_guests for insert to authenticated
  with check (
    user_id = auth.uid()
    and status = 'requested'
    and exists (
      select 1 from public.live_streams s
      where s.id = live_id
        and s.status = 'live'
        and s.host_id <> auth.uid()
        and public.is_mutual(s.host_id)
    )
  );

-- The host invites (a row for someone else) and answers requests.
drop policy if exists "hosts manage guests" on public.live_guests;
create policy "hosts manage guests"
  on public.live_guests for insert to authenticated
  with check (
    exists (
      select 1 from public.live_streams s
      where s.id = live_id and s.host_id = auth.uid() and s.status = 'live'
    )
  );

drop policy if exists "hosts answer guests" on public.live_guests;
create policy "hosts answer guests"
  on public.live_guests for update to authenticated
  using (
    exists (
      select 1 from public.live_streams s
      where s.id = live_id and s.host_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.live_streams s
      where s.id = live_id and s.host_id = auth.uid()
    )
  );

-- Leaving / withdrawing your own row. Joining is a token, not a write:
-- the grant is minted from requested/invited rows, and `joined` is set by
-- whoever watches the participant arrive (host client) or by the guest
-- itself once publishing.
drop policy if exists "guests leave their own seat" on public.live_guests;
create policy "guests leave their own seat"
  on public.live_guests for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Only the host may pin: the column is theirs to write.
drop policy if exists "hosts pin on their own live" on public.live_streams;
create policy "hosts pin on their own live"
  on public.live_streams for update to authenticated
  using (host_id = auth.uid())
  with check (host_id = auth.uid());

do $$
begin
  -- Replaces the v1 "hosts update their own live" with the same rule under a
  -- wider name; both policies would otherwise stack identical checks.
  drop policy if exists "hosts update their own live" on public.live_streams;
exception
  when undefined_object then null;
end;
$$;

-- Guests arrive and leave live on every screen watching.
do $$
declare
  t text;
begin
  foreach t in array array['live_guests'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then null;
      when undefined_table then null;
    end;
  end loop;
end;
$$;
