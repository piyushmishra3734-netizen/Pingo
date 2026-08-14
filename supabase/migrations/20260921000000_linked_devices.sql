-- The devices signed in to an account, listed and revocable.
--
-- ## There was already a device registry
--
-- `device_keys` has held one row per device since E2EE landed: an id the device
-- named itself, its public key, when it first appeared and when it was last
-- seen. Everything a "linked devices" screen needs except a name a person would
-- recognise, which is what `label` adds.
--
-- Reusing it rather than adding a sessions table is the point. Two registries
-- would disagree - a device revoked in one and still wrapped for in the other
-- is a message the revoked phone can still read - and the one that matters for
-- privacy is this one, because it is the list a sender wraps message keys for.
--
-- ## What revoking does, and what it cannot do
--
-- Deleting the row removes the device from every future wrap. It can no longer
-- read anything sent after that instant, which is the guarantee worth having.
--
-- It does not reach into that device and destroy what it has already
-- downloaded, and no server-side session kill would either. What it does do is
-- tell the device: the heartbeat writes `last_seen_at` on every launch, and a
-- device whose row is gone learns that its update matched nothing and signs
-- itself out. That is a client-side check by necessity - only the service role
-- can revoke somebody's session, and no browser here holds one.
--
-- ## Being told about a new one
--
-- The first anybody knew about a device signing in was nothing at all. A row
-- appearing in `device_keys` is exactly that event, so the notification is a
-- trigger on it rather than something a client remembers to send.

-- ---------------------------------------------------------------------------
-- 1. A name a person would recognise
-- ---------------------------------------------------------------------------

alter table public.device_keys
  add column if not exists label text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'device_keys_label_length') then
    alter table public.device_keys
      add constraint device_keys_label_length check (
        label is null or char_length(label) between 1 and 80
      );
  end if;
end
$$;

comment on column public.device_keys.label is
  'What the device calls itself ("Chrome on Windows"). Sent by the device, shown only to its owner, and never trusted for anything but display.';

-- ---------------------------------------------------------------------------
-- 2. Revoking, and making it stick
-- ---------------------------------------------------------------------------

/*
 * Why deleting the key row is not enough on its own.
 *
 * Every launch calls `publishDeviceKey`, which upserts. A revoked device
 * starting up would simply publish itself again and be back in the wraps by
 * lunchtime - a revocation that lasts until the phone is next opened is not a
 * revocation. So the id is remembered here, and the insert policy on
 * `device_keys` is narrowed to refuse it.
 *
 * The row is the tombstone. It is small, it is per device, and it is the thing
 * the revoked device reads to learn it should sign itself out.
 */
create table if not exists public.revoked_devices (
  device_id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  revoked_at timestamptz not null default now()
);

create index if not exists revoked_devices_user_idx on public.revoked_devices (user_id);

alter table public.revoked_devices enable row level security;

-- Unlike `device_keys`, this is nobody else's business: how many devices
-- somebody has thrown off their account says something about them.
drop policy if exists "read own revocations" on public.revoked_devices;
create policy "read own revocations"
  on public.revoked_devices for select
  to authenticated
  using (user_id = auth.uid());

/*
 * Asked by the insert policy on `device_keys`, so it must see rows the caller
 * cannot - a revoked device's own session is exactly who is being refused.
 */
create or replace function public.is_device_revoked(device uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from public.revoked_devices where device_id = device);
$$;

drop policy if exists "own device keys" on public.device_keys;
create policy "own device keys"
  on public.device_keys for insert
  to authenticated
  with check (user_id = auth.uid() and not public.is_device_revoked(device_id));

/*
 * Throw a device off, in one transaction.
 *
 * Both halves or neither: a delete without the tombstone comes back on the next
 * launch, and a tombstone without the delete leaves the device in every wrap.
 *
 * A device may revoke itself. That is not the ordinary way out - Logout is -
 * but somebody sitting at a borrowed computer looking at this list should not
 * have to work out which row is the one they are holding.
 */
create or replace function public.revoke_device(device uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not signed in';
  end if;

  if not exists (
    select 1 from public.device_keys where device_id = device and user_id = me
  ) then
    -- Already gone, or never yours. Both are the state being asked for.
    return;
  end if;

  insert into public.revoked_devices (device_id, user_id)
  values (device, me)
  on conflict (device_id) do nothing;

  delete from public.device_keys where device_id = device and user_id = me;
end;
$$;

revoke all on function public.revoke_device(uuid) from public;
grant execute on function public.revoke_device(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Telling somebody a device signed in
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
        -- A device published a key against this account. The one notification
        -- here that is a security event rather than a social one.
        'new_device'
      )
    );

/*
 * Not the first device, and not a device coming back.
 *
 * A brand new account publishing its first key is somebody signing up, and
 * telling them their own phone just signed in is noise on the first screen they
 * ever see. Every device after that is worth knowing about, because the whole
 * value of this notification is the one nobody expected.
 *
 * `actor_id` is null: the account itself did this, and pointing it at the owner
 * would draw their own face beside "a new device signed in".
 */
create or replace function public.notify_new_device()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.device_keys where user_id = new.user_id) <= 1 then
    return new;
  end if;

  insert into public.notifications (user_id, actor_id, kind, subject_id)
  values (new.user_id, null, 'new_device', new.device_id);

  return new;
end;
$$;

drop trigger if exists device_keys_notify_new on public.device_keys;
create trigger device_keys_notify_new
  after insert on public.device_keys
  for each row
  execute function public.notify_new_device();

/*
 * Re-stated from `20260822000000_notification_kinds`, with one line added.
 *
 * Copied whole rather than patched, because `create or replace function` has no
 * way to add a branch - and rebuilding it from the older `20260817` version
 * would have quietly reverted the per-kind preference switches.
 */
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
  /*
   * A security notification is not silenced by preferences.
   *
   * Mute and quiet hours exist so a messenger does not wake somebody at 3am
   * about a story. "A device you do not recognise just signed in" is the one
   * message where 3am is the point, and a switch that suppressed it would be a
   * switch that hides break-ins. Checked before the prefs are even read.
   */
  if event_kind = 'new_device' then
    return true;
  end if;

  select * into p from public.notification_prefs where user_id = target;

  if not found then
    return true;
  end if;

  if p.muted then
    return false;
  end if;

  case event_kind
    when 'message' then if not p.messages then return false; end if;
    when 'voice' then if not p.messages then return false; end if;
    when 'snap' then if not p.messages then return false; end if;
    when 'mention' then if not p.messages then return false; end if;
    when 'story' then if not p.stories then return false; end if;
    when 'story_reply' then if not p.stories then return false; end if;
    when 'like' then if not p.stories then return false; end if;
    when 'comment' then if not p.stories then return false; end if;
    when 'follow_request' then if not p.friend_requests then return false; end if;
    when 'follow_accepted' then if not p.friend_requests then return false; end if;
    when 'call' then if not p.calls then return false; end if;
    when 'ai' then if not p.ai then return false; end if;
    when 'journey' then if not p.journey then return false; end if;
    when 'marketing' then if not p.marketing then return false; end if;
    else null;
  end case;

  if p.quiet_enabled then
    local_minute := (
      extract(hour from (now() at time zone 'utc') + make_interval(mins => p.utc_offset_minutes)) * 60
      + extract(minute from (now() at time zone 'utc') + make_interval(mins => p.utc_offset_minutes))
    )::integer;

    /*
     * A call is not silenced by quiet hours.
     *
     * Everything else here can wait until morning; somebody ringing you at
     * three in the morning is usually the reason quiet hours have an exception
     * at all. If that turns out to be wrong it becomes its own switch, not a
     * silent rule.
     */
    if event_kind <> 'call' then
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
  end if;

  return true;
end;
$$;
