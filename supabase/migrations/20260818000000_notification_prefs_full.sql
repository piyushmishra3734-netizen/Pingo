-- Notification preferences, in the shape the product actually offers.
--
-- The first version of this table was written to unblock the trigger and had
-- only what the trigger needed. This is the full set, and it is the *only* copy
-- - the settings screen wrote to localStorage before, which meant a preference
-- turned off on a phone was invisible to the server that does the sending. A
-- person could switch notifications off and keep receiving them, which is the
-- kind of thing that loses trust permanently and is never reported as a bug.
--
-- ## One source, not two
--
-- Nothing caches these as an alternative source of truth. The client keeps a
-- copy for instant rendering, but the copy is written *after* the server
-- accepts the change, and the server is what the trigger reads. Two writable
-- copies of a preference is how a setting ends up different on two phones with
-- no way to tell which is right.
--
-- ## Defaults are opinions
--
-- Everything a person asked for is on: messages, calls, friend requests,
-- stories, AI replies. Everything *we* might want to send them is off: journey
-- and marketing. A product should have to earn the right to interrupt somebody
-- about its own goals, and defaulting those to on is how that permission gets
-- taken rather than given.

alter table public.notification_prefs
  add column if not exists friend_requests boolean not null default true,
  add column if not exists stories boolean not null default true,
  add column if not exists ai boolean not null default true,
  -- Off. See the note above, and docs/journey-philosophy.md: never pressure,
  -- never punish, never manipulate. A streak about to break is all three.
  add column if not exists journey boolean not null default false,
  add column if not exists marketing boolean not null default false,
  /*
   * How much of a notification appears on a locked screen.
   *
   * `sender_only` is the default and the only setting that keeps the product's
   * privacy claim intact without qualification: no message text ever enters an
   * FCM payload, so nothing readable passes through Google's infrastructure.
   *
   * `sender_and_text` is a deliberate, informed trade the user makes about
   * their own messages. It is not the default and never will be.
   */
  add column if not exists preview text not null default 'sender_only'
    check (preview in ('sender_only', 'sender_and_text', 'hidden'));

/*
 * `social` is replaced by the two settings it used to conflate.
 *
 * A follow request and a story are not the same interruption - one is a person
 * asking for something and the other is a person posting - and a single switch
 * meant turning off the noisier one silenced the one that mattered. Existing
 * rows carry their old value into both, so nobody's choice is quietly widened.
 */
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'notification_prefs' and column_name = 'social'
  ) then
    update public.notification_prefs set friend_requests = social, stories = social;
    alter table public.notification_prefs drop column social;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- The gate, rewritten against the full set
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

  -- Never configured: notify. Silence is not a safe default for a messenger,
  -- and an absent row means "has not opened settings", not "wants nothing".
  if not found then
    return true;
  end if;

  if p.muted then
    return false;
  end if;

  case event_kind
    when 'message' then if not p.messages then return false; end if;
    when 'snap' then if not p.messages then return false; end if;
    when 'story' then if not p.stories then return false; end if;
    when 'follow_request' then if not p.friend_requests then return false; end if;
    when 'follow_accepted' then if not p.friend_requests then return false; end if;
    when 'call' then if not p.calls then return false; end if;
    when 'ai' then if not p.ai then return false; end if;
    when 'journey' then if not p.journey then return false; end if;
    when 'marketing' then if not p.marketing then return false; end if;
    else null; -- An unknown kind is delivered rather than dropped silently.
  end case;

  if p.quiet_enabled then
    local_minute := (
      extract(hour from (now() at time zone 'utc') + make_interval(mins => p.utc_offset_minutes)) * 60
      + extract(minute from (now() at time zone 'utc') + make_interval(mins => p.utc_offset_minutes))
    )::integer;

    -- Wraps past midnight when start > end, which is the normal 22:00-07:00
    -- case and exactly what a naive BETWEEN gets wrong.
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
-- The trigger, now carrying the preview choice
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
  chosen_preview text;
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

  select coalesce(preview, 'sender_only') into chosen_preview
  from public.notification_prefs where user_id = new.user_id;
  chosen_preview := coalesce(chosen_preview, 'sender_only');

  select display_name into actor_name
  from public.profiles
  where id = new.actor_id;

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
      'count', unread_count,
      'preview', chosen_preview
    ),
    timeout_milliseconds := 5000
  );

  return new;
exception
  when others then
    insert into public.push_failures (notification_id, user_id, reason)
    values (new.id, new.user_id, left(sqlerrm, 500));
    return new;
end;
$$;
