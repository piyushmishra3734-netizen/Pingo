-- Point production triggers at the active project.
--
-- ## Why this exists
--
-- The database was rebuilt on a new Supabase project by dump-restore
-- (`supabase/migrate/`), which carried the function *bodies* across verbatim -
-- including three hardcoded Edge Function URLs that still name the old,
-- inactive project (`lppzoqgvshhmxqsvggug`). The old project is dead, so every
-- one of these calls goes nowhere:
--
--   1. `on_notification_push` -> `push-send`: every chat message's push.
--   2. `push_retry_due` -> `push-send`: every push retry, every minute.
--   3. `media_sweeper_tick` -> `purge-media`: the hourly media sweep.
--
-- In other words: pushes have been silently failing since the move, and absent
-- senders' media has not been server-collected. Both failures are silent by
-- design (a failed notification must never block a message; a failed sweep
-- costs an hour, not a leak), which is why nothing screamed.
--
-- ## What this does
--
-- Replaces the three function bodies with byte-identical copies except for the
-- URL, which now names the active project (`gpijpmepzowwhvgkriqu`). No logic
-- changes, no trigger changes, no new behaviour - the same calls, to the live
-- project. `CREATE OR REPLACE` is safe to run on either project: on the old
-- one it would be a no-op rename to a live URL, and the old one is gone.
--
-- Older migrations are left untouched on purpose: they are history, and
-- rewriting history breaks every database that already applied them.

-- ---------------------------------------------------------------------------
-- 1. Push fan-out -> active project's push-send
-- (body from 20260942000000, URL only changed)
-- ---------------------------------------------------------------------------

create or replace function public.on_notification_push()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  secret text;
  base_url text := 'https://gpijpmepzowwhvgkriqu.supabase.co/functions/v1/push-send';
  chunk record;
  any_target boolean;
begin
  /*
   * Is there anybody to send to at all? Asked before the vault is opened,
   * because on this product most recipients have never granted notification
   * permission and the answer is usually no.
   */
  select exists (
    select 1
      from inserted i
     where public.push_allowed(i.user_id, i.kind)
       and exists (select 1 from public.device_tokens d where d.user_id = i.user_id)
  ) into any_target;

  if not any_target then
    return null;
  end if;

  select decrypted_secret into secret
  from vault.decrypted_secrets
  where name = 'push_trigger_secret';

  if secret is null then
    insert into public.push_failures (notification_id, user_id, reason)
    select i.id, i.user_id, 'push_trigger_secret missing from vault' from inserted i
    on conflict (notification_id) do nothing;
    return null;
  end if;

  /*
   * Everything each recipient needs, gathered once.
   *
   * The unread count is the expensive part and used to run once per member of
   * the group, per message. One lateral over the statement's rows replaces the
   * lot.
   */
  for chunk in
    select jsonb_agg(payload) as recipients
      from (
        select jsonb_build_object(
                 'notificationId', i.id,
                 'userId', i.user_id,
                 'kind', i.kind,
                 'actorId', i.actor_id,
                 'actorName', coalesce(p.display_name, 'Someone'),
                 'subjectId', i.subject_id,
                 'count', u.unread,
                 'preview', coalesce(np.preview, 'sender_only')
               ) as payload,
               (row_number() over (order by i.id) - 1) / 100 as bucket
          from inserted i
          left join public.profiles p on p.id = i.actor_id
          left join public.notification_prefs np on np.user_id = i.user_id
          join lateral (
            select count(*) as unread
              from public.notifications n
             where n.user_id = i.user_id
               and n.kind = i.kind
               and n.actor_id is not distinct from i.actor_id
               and n.read_at is null
          ) u on true
         where public.push_allowed(i.user_id, i.kind)
           and exists (select 1 from public.device_tokens d where d.user_id = i.user_id)
      ) ready
     group by bucket
  loop
    perform net.http_post(
      url := base_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-pingo-push-secret', secret
      ),
      body := jsonb_build_object('recipients', chunk.recipients),
      timeout_milliseconds := 10000
    );
  end loop;

  return null;
exception
  when others then
    insert into public.push_failures (notification_id, user_id, reason, kind, actor_id)
    select i.id, i.user_id, left(sqlerrm, 500), i.kind, i.actor_id from inserted i
    on conflict (notification_id) do nothing;
    return null;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 2. Push retry worker -> active project's push-send
-- (body from 20260819000000, URL only changed)
-- ---------------------------------------------------------------------------

create or replace function public.push_retry_due()
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  secret text;
  row_to_retry record;
  processed integer := 0;
  base_url text := 'https://gpijpmepzowwhvgkriqu.supabase.co/functions/v1/push-send';
  next_wait interval;
begin
  select decrypted_secret into secret
  from vault.decrypted_secrets
  where name = 'push_trigger_secret';

  if secret is null then
    return 0;
  end if;

  /*
   * `for update skip locked` so two overlapping cron ticks cannot pick up the
   * same row. The job runs every minute and a slow tick can still be running
   * when the next one starts; without this, both would send.
   *
   * Capped per tick so one enormous backlog cannot monopolise a worker.
   */
  for row_to_retry in
    select f.*, n.created_at as notified_at
    from public.push_failures f
    left join public.notifications n on n.id = f.notification_id
    where f.next_attempt_at <= now()
    order by f.next_attempt_at
    limit 200
    for update of f skip locked
  loop
    -- Already delivered by an overlapping attempt: drop the queue entry rather
    -- than send a second copy.
    if row_to_retry.notification_id is not null
       and exists (select 1 from public.push_deliveries d
                   where d.notification_id = row_to_retry.notification_id) then
      delete from public.push_failures where id = row_to_retry.id;
      continue;
    end if;

    next_wait := public.push_backoff(row_to_retry.attempts + 1);

    if next_wait is null then
      -- Out of attempts. Kept, not deleted: a notification nobody received is
      -- exactly the history worth having.
      insert into public.dead_letter_notifications (
        notification_id, user_id, reason, last_error, attempt_count, created_at
      )
      values (
        row_to_retry.notification_id,
        row_to_retry.user_id,
        'retries exhausted',
        row_to_retry.last_error,
        row_to_retry.attempts,
        coalesce(row_to_retry.notified_at, row_to_retry.created_at)
      );

      delete from public.push_failures where id = row_to_retry.id;
      processed := processed + 1;
      continue;
    end if;

    perform net.http_post(
      url := base_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-pingo-push-secret', secret
      ),
      body := jsonb_build_object(
        'notificationId', row_to_retry.notification_id,
        'userId', row_to_retry.user_id,
        'kind', coalesce(row_to_retry.kind, 'message'),
        'actorId', row_to_retry.actor_id,
        'actorName', coalesce(row_to_retry.actor_name, 'Someone'),
        'subjectId', row_to_retry.subject_id,
        'count', 1,
        'retry', true
      ),
      timeout_milliseconds := 5000
    );

    /*
     * Rescheduled immediately rather than on the response.
     *
     * pg_net is asynchronous, so this function never learns the outcome. The
     * row is pushed to its next slot now; a success deletes it from the queue
     * inside the Edge Function, which gets there first in every case that
     * matters. The cost of the alternative - waiting - is a row that retries
     * forever if a response is never seen at all.
     */
    update public.push_failures
    set attempts = attempts + 1,
        last_attempt_at = now(),
        next_attempt_at = now() + next_wait
    where id = row_to_retry.id;

    processed := processed + 1;
  end loop;

  return processed;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Media sweeper -> active project's purge-media
-- (body from 20260919000000, URL only changed)
-- ---------------------------------------------------------------------------

create or replace function public.media_sweeper_tick()
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  secret text;
  parked integer;
begin
  select public.purge_delivered_media() into parked;

  select decrypted_secret into secret
  from vault.decrypted_secrets
  where name = 'media_sweeper_secret';

  -- No secret means the function has not been configured yet. Parking still
  -- happened, and the uploaders' own clients still collect; nothing is lost by
  -- returning here beyond the sweep for absent senders.
  if secret is null then
    return parked;
  end if;

  perform net.http_post(
    url := 'https://gpijpmepzowwhvgkriqu.supabase.co/functions/v1/purge-media',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-pingo-sweeper-secret', secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );

  return parked;
end;
$$;
