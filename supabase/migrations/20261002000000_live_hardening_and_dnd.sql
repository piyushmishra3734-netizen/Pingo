-- Live hardening, and Do Not Disturb put back.
--
-- ## Do Not Disturb
--
-- 20260965000000 (live streams) rewrote `push_allowed` to add the 'live' kind,
-- from a copy that predated 20260960000000 (presence_dnd) - so the `or p.dnd`
-- clause went, and anyone on Do Not Disturb started getting pushes again.
-- Below is the live body with the clause back.
--
-- ## A guest cannot seat themselves
--
-- "guests leave their own seat" lets a user update their own `live_guests` row
-- to any status, and `live-token` grants publishing to `invited`/`joined` - so a
-- viewer could ask, then set their own row to `joined`, and go on air without
-- the host. A policy cannot compare old and new status (permissive policies OR
-- their USING and WITH CHECK separately), so a trigger holds the transitions:
-- the host may do anything; a guest may accept an invite, leave, decline, or
-- ask again after leaving - never promote themselves.
--
-- ## One live at a time, one notification wave per half hour
--
-- Every insert into `live_streams` notified every mutual follower, and nothing
-- limited inserts - going live in a loop was a way to spam everyone you know
-- (and to spend the push budget doing it). A new live now ends the host's
-- previous one, a partial unique index holds "one live per host", start times
-- are the server's, and the fanout skips a host who went live in the last 30
-- minutes.
--
-- Applied to gpijpmepzowwhvgkriqu through the Supabase MCP as
-- `live_hardening_and_dnd`.

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

  if p.muted or p.dnd then
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

create or replace function public.live_guests_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if new.live_id is distinct from old.live_id or new.user_id is distinct from old.user_id then
    raise exception 'A seat cannot move.' using errcode = '42501';
  end if;

  if exists (select 1 from public.live_streams s where s.id = new.live_id and s.host_id = auth.uid()) then
    return new;
  end if;

  if new.status = old.status
     or new.status in ('left', 'declined')
     or (old.status = 'invited' and new.status = 'joined')
     or (old.status in ('left', 'declined') and new.status = 'requested') then
    return new;
  end if;

  raise exception 'Only the host can put you on air.' using errcode = '42501';
end;
$$;

drop trigger if exists live_guests_guard on public.live_guests;
create trigger live_guests_guard
  before update on public.live_guests
  for each row execute function public.live_guests_guard();

create or replace function public.live_streams_one_at_a_time()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The server's clock, so a backdated insert cannot dodge the throttle below.
  new.started_at := now();
  new.created_at := now();

  update public.live_streams
     set status = 'ended', ended_at = coalesce(ended_at, now()), viewer_count = 0
   where host_id = new.host_id and status = 'live';

  return new;
end;
$$;

drop trigger if exists live_streams_one_at_a_time on public.live_streams;
create trigger live_streams_one_at_a_time
  before insert on public.live_streams
  for each row execute function public.live_streams_one_at_a_time();

create unique index if not exists live_streams_one_live_per_host
  on public.live_streams (host_id)
  where status = 'live';

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

  -- One wave per half hour: a restart, a crash-and-rejoin or a loop notifies once.
  if exists (
    select 1 from public.live_streams earlier
     where earlier.host_id = new.host_id
       and earlier.id <> new.id
       and earlier.started_at > now() - interval '30 minutes'
  ) then
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
