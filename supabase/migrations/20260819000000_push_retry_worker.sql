-- The retry worker.
--
-- A notification must not be lost because FCM was busy for ten seconds. The
-- trigger is fire-and-forget by design - it must never hold up the transaction
-- that created the message - so something else has to notice a delivery that
-- did not happen. This is that something.
--
-- ## What is retried, and what is not
--
-- A 429 or a 5xx means "try later". `UNREGISTERED` and `INVALID_ARGUMENT` mean
-- "this device is gone", and retrying those is not persistence, it is a loop
-- that can never succeed. The first goes in the queue; the second prunes the
-- token and stops.
--
-- ## Delivered at most once, across every path
--
-- The trigger and the worker both call the same endpoint, and a slow first
-- attempt can overlap a retry. `push_deliveries` has a unique key on the
-- notification, so the second one to arrive loses the insert and returns
-- without sending. Idempotency lives at the bottom of the pipeline rather than
-- being coordinated between the two callers - anything else is a race waiting
-- for a bad week.

create extension if not exists pg_cron with schema extensions;

-- ---------------------------------------------------------------------------
-- The ledger. One row per notification actually delivered.
-- ---------------------------------------------------------------------------

create table if not exists public.push_deliveries (
  -- The idempotency key, and the reason this table exists at all.
  notification_id uuid primary key references public.notifications (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  device_count integer not null default 0,
  attempts integer not null default 1,
  -- From the notification being created to it reaching FCM. What "average
  -- latency" is measured over, and it includes every retry that came first.
  latency_ms integer,
  sent_at timestamptz not null default now()
);

alter table public.push_deliveries enable row level security;
-- Operational. Service role only; nothing in a browser reads it.

-- ---------------------------------------------------------------------------
-- Tokens that were removed, kept briefly so pruning is measurable
-- ---------------------------------------------------------------------------

create table if not exists public.push_pruned_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  reason text not null,
  pruned_at timestamptz not null default now()
);

alter table public.push_pruned_tokens enable row level security;

-- ---------------------------------------------------------------------------
-- Failures, now with a schedule
-- ---------------------------------------------------------------------------

alter table public.push_failures
  add column if not exists next_attempt_at timestamptz not null default now(),
  add column if not exists last_error text,
  add column if not exists kind text,
  add column if not exists actor_id uuid,
  add column if not exists actor_name text,
  add column if not exists subject_id uuid;

/*
 * One queue entry per notification.
 *
 * Without this a notification that fails twice has two rows, and both get
 * retried on their own schedules - which is how one message becomes four
 * notifications on somebody's phone.
 */
create unique index if not exists push_failures_notification_uniq
  on public.push_failures (notification_id)
  where notification_id is not null;

create index if not exists push_failures_due_idx
  on public.push_failures (next_attempt_at);

-- ---------------------------------------------------------------------------
-- Dead letters
-- ---------------------------------------------------------------------------

create table if not exists public.dead_letter_notifications (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid,
  user_id uuid,
  reason text not null,
  last_error text,
  attempt_count integer not null,
  -- When the notification happened, and when we gave up. Both, because the gap
  -- between them is the question anybody looking at this table is asking.
  created_at timestamptz not null,
  failed_at timestamptz not null default now()
);

alter table public.dead_letter_notifications enable row level security;

create index if not exists dead_letter_failed_at_idx
  on public.dead_letter_notifications (failed_at);

-- ---------------------------------------------------------------------------
-- Backoff
-- ---------------------------------------------------------------------------

/**
 * How long until attempt number `n`, with jitter.
 *
 * 1m, 5m, 15m, 1h, 6h, 24h. Beyond the sixth there is no next attempt and the
 * caller dead-letters instead.
 *
 * The +/-15% is not decoration. An outage fails every pending notification at
 * once, and a fixed ladder would then wake all of them in the same second,
 * against a service that has just come back up - the retry becomes a second
 * outage. Spreading them is what makes the recovery survivable.
 */
create or replace function public.push_backoff(n integer)
returns interval
language plpgsql
immutable
as $$
declare
  base interval;
  jitter numeric;
begin
  base := case n
    when 1 then interval '1 minute'
    when 2 then interval '5 minutes'
    when 3 then interval '15 minutes'
    when 4 then interval '1 hour'
    when 5 then interval '6 hours'
    when 6 then interval '24 hours'
    else null
  end;

  if base is null then
    return null;
  end if;

  -- 0.85 to 1.15
  jitter := 0.85 + (random() * 0.30);
  return base * jitter;
end;
$$;

-- ---------------------------------------------------------------------------
-- The worker
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
  base_url text := 'https://lppzoqgvshhmxqsvggug.supabase.co/functions/v1/push-send';
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
-- Retention: dead letters are history, not an archive
-- ---------------------------------------------------------------------------

create or replace function public.push_prune_history()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  delete from public.dead_letter_notifications where failed_at < now() - interval '30 days';
  get diagnostics removed = row_count;

  delete from public.push_pruned_tokens where pruned_at < now() - interval '30 days';
  -- Deliveries are the denominator of every metric below, and one row per
  -- notification is cheap. Kept to 30 days for the same reason as the rest.
  delete from public.push_deliveries where sent_at < now() - interval '30 days';

  return removed;
end;
$$;

-- ---------------------------------------------------------------------------
-- Metrics
-- ---------------------------------------------------------------------------

/**
 * One row, answering the five questions worth asking about push.
 *
 * A view rather than a counters table, because counters drift and a view
 * cannot: it is derived from the same rows the pipeline actually writes.
 */
create or replace view public.push_metrics as
select
  (select count(*) from public.push_deliveries) as delivered,
  (select count(*) from public.dead_letter_notifications) as dead_letters,
  (select count(*) from public.push_failures) as queued,
  (select count(*) from public.push_pruned_tokens) as pruned_tokens,
  (select coalesce(sum(attempts) - count(*), 0) from public.push_deliveries) as retries_before_success,
  (select round(avg(latency_ms)) from public.push_deliveries) as avg_latency_ms,
  (
    select case
      when (select count(*) from public.push_deliveries)
         + (select count(*) from public.dead_letter_notifications) = 0 then null
      else round(
        100.0 * (select count(*) from public.push_deliveries)
        / ((select count(*) from public.push_deliveries)
         + (select count(*) from public.dead_letter_notifications)), 2)
    end
  ) as success_rate_percent;

-- ---------------------------------------------------------------------------
-- Schedule
-- ---------------------------------------------------------------------------

-- Unscheduled first so re-running this migration does not stack duplicate jobs.
select cron.unschedule('pingo-push-retry') where exists (
  select 1 from cron.job where jobname = 'pingo-push-retry'
);
select cron.unschedule('pingo-push-history') where exists (
  select 1 from cron.job where jobname = 'pingo-push-history'
);

-- Every minute: the shortest rung on the ladder is one minute, so anything
-- less frequent would make the first retry slower than it says it is.
select cron.schedule('pingo-push-retry', '* * * * *', $$select public.push_retry_due();$$);

-- Once a day, off the hour. Retention is not urgent and does not need to
-- compete with whatever else runs at midnight.
select cron.schedule('pingo-push-history', '17 3 * * *', $$select public.push_prune_history();$$);
