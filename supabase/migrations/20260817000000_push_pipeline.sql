-- Push delivery, driven from the database.
--
-- ## Why the trigger and not the client
--
-- The obvious place to send a push is wherever the message was sent from. It is
-- also the wrong place: the sender's app can be killed, backgrounded or offline
-- the instant after a write lands, and then the recipient is never told. The
-- database already knows a notification happened - `notify_user` is the single
-- funnel every kind goes through - so delivery hangs off the row rather than off
-- whoever caused it.
--
-- ## Preferences are honoured only if the server can see them
--
-- Notification settings currently live in `localStorage` on each device, which
-- means the server cannot read them and a push would ignore every one. So they
-- get a table here. It is deliberately narrow - mute, per-kind switches, quiet
-- hours - because these are the only ones that can change whether a push is
-- *sent*, and a preference the server cannot act on has no business being here.
--
-- Absent row means notify. A person who has never opened the settings screen
-- should still hear about their messages.
--
-- ## Failures are queued, not lost
--
-- pg_net is fire-and-forget: it hands the request off and the transaction
-- commits regardless. That is what keeps a failed notification from rolling
-- back the message that caused it, but it also means nothing notices a delivery
-- that never happened. `push_failures` is where those land so a retry can pick
-- them up, rather than the failure existing only in a log nobody reads.

create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------------------
-- Server-visible notification preferences
-- ---------------------------------------------------------------------------

create table if not exists public.notification_prefs (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- Silences everything, and is checked first so the rest need not be consulted.
  muted boolean not null default false,
  messages boolean not null default true,
  groups boolean not null default true,
  calls boolean not null default true,
  social boolean not null default true,
  /*
   * Quiet hours as local minutes-since-midnight, plus the offset needed to
   * interpret them. A timestamp would be wrong: "22:00" means the user's ten
   * at night wherever they are, not a fixed instant, and storing a zone name
   * would need a tz database lookup inside a trigger.
   */
  quiet_enabled boolean not null default false,
  quiet_start_minute smallint not null default 1320,
  quiet_end_minute smallint not null default 420,
  utc_offset_minutes smallint not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.notification_prefs enable row level security;

drop policy if exists "users read their own notification prefs" on public.notification_prefs;
create policy "users read their own notification prefs"
  on public.notification_prefs for select
  using (auth.uid() = user_id);

drop policy if exists "users write their own notification prefs" on public.notification_prefs;
create policy "users write their own notification prefs"
  on public.notification_prefs for insert
  with check (auth.uid() = user_id);

drop policy if exists "users update their own notification prefs" on public.notification_prefs;
create policy "users update their own notification prefs"
  on public.notification_prefs for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Failed deliveries, kept for retry
-- ---------------------------------------------------------------------------

create table if not exists public.push_failures (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid references public.notifications (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  reason text not null,
  attempts integer not null default 1,
  created_at timestamptz not null default now(),
  last_attempt_at timestamptz not null default now()
);

alter table public.push_failures enable row level security;
-- No policies at all: this is operational data. The service role bypasses RLS
-- and nothing in the browser has any reason to read it.

-- ---------------------------------------------------------------------------
-- Should this person be told, right now?
-- ---------------------------------------------------------------------------

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

  -- Never configured: notify. Silence is not a safe default for a messenger.
  if not found then
    return true;
  end if;

  if p.muted then
    return false;
  end if;

  if event_kind = 'message' and not p.messages then return false; end if;
  if event_kind = 'snap' and not p.messages then return false; end if;
  if event_kind = 'story' and not p.social then return false; end if;
  if event_kind in ('follow_request', 'follow_accepted') and not p.social then
    return false;
  end if;

  if p.quiet_enabled then
    local_minute := (extract(hour from (now() at time zone 'utc') + make_interval(mins => p.utc_offset_minutes)) * 60
                   + extract(minute from (now() at time zone 'utc') + make_interval(mins => p.utc_offset_minutes)))::integer;

    -- Wraps past midnight when start > end, which is the normal case for a
    -- 22:00-07:00 window and the thing a naive BETWEEN gets wrong.
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

-- ---------------------------------------------------------------------------
-- The trigger
-- ---------------------------------------------------------------------------

create or replace function public.on_notification_push()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  secret text;
  actor_name text;
  unread_count integer;
  base_url text := 'https://lppzoqgvshhmxqsvggug.supabase.co/functions/v1/push-send';
begin
  if not public.push_allowed(new.user_id, new.kind) then
    return new;
  end if;

  select decrypted_secret into secret
  from vault.decrypted_secrets
  where name = 'push_trigger_secret';

  if secret is null then
    insert into public.push_failures (notification_id, user_id, reason)
    values (new.id, new.user_id, 'push_trigger_secret missing from vault');
    return new;
  end if;

  select display_name into actor_name
  from public.profiles
  where id = new.actor_id;

  /*
   * How many unanswered notifications of this kind this person has from this
   * actor, including the one being inserted.
   *
   * This is what turns three messages in three seconds into "3 new messages"
   * rather than three separate lines on a lock screen. The count travels to
   * the sender, which pairs it with a collapse key so the newest notification
   * *replaces* the previous one instead of stacking beside it.
   */
  select count(*) into unread_count
  from public.notifications
  where user_id = new.user_id
    and kind = new.kind
    and actor_id is not distinct from new.actor_id
    and read_at is null;

  perform net.http_post(
    url := base_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-pingo-push-secret', secret
    ),
    body := jsonb_build_object(
      'userId', new.user_id,
      'kind', new.kind,
      'actorId', new.actor_id,
      'actorName', coalesce(actor_name, 'Someone'),
      'subjectId', new.subject_id,
      'count', unread_count
    ),
    timeout_milliseconds := 5000
  );

  return new;
exception
  when others then
    /*
     * Never raise. This trigger runs inside the transaction that created the
     * message, and a push that could not be sent must not undo a message that
     * was. The failure is recorded instead.
     */
    insert into public.push_failures (notification_id, user_id, reason)
    values (new.id, new.user_id, left(sqlerrm, 500));
    return new;
end;
$$;

drop trigger if exists notifications_push on public.notifications;
create trigger notifications_push
  after insert on public.notifications
  for each row
  execute function public.on_notification_push();
