-- Event-driven background jobs (2026-11-22).
--
-- Four pg_cron jobs ran every minute (5,760 runs a day) and almost always found nothing to do: push retries, the AI
-- action ticker, chat wipes and private-session expiry. Every run still wrote a row to cron.job_run_details and
-- updated it, and that steady stream of writes (275k log rows) helped drain the Disk IO budget until the whole
-- database slowed to a crawl on 2026-11-22 15:10 UTC.
--
-- Now each of those jobs sleeps until there is work:
--   * a trigger on the work table arms the job for the minute its first item is due ("arming" = one pg_cron
--     schedule for that exact minute, e.g. '41 15 22 11 *');
--   * when the job runs it does its work and re-arms itself for the next item, or removes itself when nothing is left;
--   * the hourly notes-sweep job also calls cron_rearm_all() as a safety net, so a missed minute (pg_cron
--     "job startup timeout") or a failed run never leaves work behind for long.
-- The worker functions themselves (push_retry_due, master_tick, run_chat_wipes, private_sweep) are unchanged.
--
-- Also: cron.job_run_details is pruned daily to 3 days.

create table if not exists public.cron_arms (
  jobname    text primary key,
  armed_for  timestamptz
);
alter table public.cron_arms enable row level security;   -- no policies: only the security definer functions below touch it
revoke all on public.cron_arms from anon, authenticated;

-- When is the next item of a job due? null = nothing to do.
create or replace function public.cron_next_due(p_job text)
returns timestamptz
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare d timestamptz;
begin
  if p_job = 'pingo-push-retry' then
    select min(next_attempt_at) into d from public.push_failures;
  elsif p_job = 'master-tick' then
    select least(
      (select min(run_at)     from public.ai_actions where status = 'scheduled' and run_at is not null),
      (select min(undo_at)    from public.ai_actions where undo is not null and undo_at is not null),
      (select min(expires_at) from public.ai_actions where status = 'pending' and expires_at is not null)
    ) into d;
  elsif p_job = 'chat-wipes' then
    select case when exists (select 1 from public.chat_wipes) then now() end into d;
  elsif p_job = 'private-sweep' then
    select least(
      (select min(expires_at)               from public.private_sessions where state = 'active'),
      (select min(ended_at) + interval '1 day' from public.private_sessions where state = 'ended' and ended_at is not null)
    ) into d;
  else
    raise exception 'cron_next_due: unknown job %', p_job;
  end if;
  return d;
end;
$$;

-- Arm (or disarm) a job for its next due item. Callers must hold the cron_arms row lock (cron_lock).
-- p_force: replace the schedule even if an earlier minute is already armed (used by the job itself after running).
create or replace function public.cron_arm(p_job text, p_force boolean default false)
returns timestamptz
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  a   timestamptz;
  due timestamptz;
  t   timestamptz;
  g   timestamp;
begin
  select armed_for into a from public.cron_arms where jobname = p_job;
  due := public.cron_next_due(p_job);

  if due is null then
    if exists (select 1 from cron.job where jobname = p_job) then perform cron.unschedule(p_job); end if;
    if a is not null then update public.cron_arms set armed_for = null where jobname = p_job; end if;
    return null;
  end if;

  -- the first whole minute at or after the due time, and never earlier than the next minute
  t := date_trunc('minute', greatest(due, now() + interval '1 minute') + interval '59 seconds');

  -- already armed for an earlier (or the same) minute that has not passed yet: nothing to write
  if not p_force and a is not null and a <= t and a >= now() - interval '1 minute'
     and exists (select 1 from cron.job where jobname = p_job) then
    return a;
  end if;

  g := t at time zone 'GMT';     -- pg_cron runs in GMT (cron.timezone)
  perform cron.schedule(p_job,
    format('%s %s %s %s *', extract(minute from g)::int, extract(hour from g)::int, extract(day from g)::int, extract(month from g)::int),
    format('select public.cron_run(%L)', p_job));
  update public.cron_arms set armed_for = t where jobname = p_job;
  return t;
end;
$$;

-- Take the per-job lock row (created on first use). Serialises the job run against the triggers that arm it, so an
-- item inserted while the job runs is never lost: the trigger waits, then sees the job's new state and re-arms.
create or replace function public.cron_lock(p_job text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.cron_arms (jobname) values (p_job) on conflict (jobname) do nothing;
  perform 1 from public.cron_arms where jobname = p_job for update;
end;
$$;

-- What pg_cron calls: lock, run the unchanged worker, re-arm for the next item (or disarm).
create or replace function public.cron_run(p_job text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public.cron_lock(p_job);
  perform set_config('pingo.cron_worker', 'on', true);       -- the triggers below stay quiet while the worker edits its own tables
  if p_job = 'pingo-push-retry' then perform public.push_retry_due();
  elsif p_job = 'master-tick' then perform public.master_tick();
  elsif p_job = 'chat-wipes' then perform public.run_chat_wipes();
  elsif p_job = 'private-sweep' then perform public.private_sweep();
  else raise exception 'cron_run: unknown job %', p_job;
  end if;
  perform set_config('pingo.cron_worker', 'off', true);
  perform public.cron_arm(p_job, true);
end;
$$;

-- Safety net, called hourly: re-arm every job from its table (fixes a missed minute or a failed run).
create or replace function public.cron_rearm_all()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare j text; a timestamptz;
begin
  foreach j in array array['pingo-push-retry', 'master-tick', 'chat-wipes', 'private-sweep'] loop
    begin
      perform public.cron_lock(j);
      select armed_for into a from public.cron_arms where jobname = j;
      perform public.cron_arm(j, a is null or a < now() - interval '2 minutes'
                                 or not exists (select 1 from cron.job where jobname = j));
    exception when others then
      raise warning 'cron_rearm_all %: %', j, sqlerrm;
    end;
  end loop;
end;
$$;

-- Trigger: work was added or its due time changed -> make sure the job is armed. Never fails the user's action:
-- any problem (lock wait > 3 s, pg_cron error) is only a warning; the hourly safety net arms it then.
create or replace function public.cron_wake()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare prev text;
begin
  if coalesce(current_setting('pingo.cron_worker', true), 'off') = 'on' then return null; end if;
  prev := current_setting('lock_timeout');
  begin
    perform set_config('lock_timeout', '3s', true);
    perform public.cron_lock(tg_argv[0]);
    perform public.cron_arm(tg_argv[0], false);
    perform set_config('lock_timeout', prev, true);
  exception when others then
    perform set_config('lock_timeout', prev, true);
    raise warning 'cron_wake %: %', tg_argv[0], sqlerrm;
  end;
  return null;
end;
$$;

revoke all on function public.cron_next_due(text), public.cron_arm(text, boolean), public.cron_lock(text),
  public.cron_run(text), public.cron_rearm_all(), public.cron_wake() from public, anon, authenticated;

drop trigger if exists cron_wake_push on public.push_failures;
create trigger cron_wake_push after insert or update of next_attempt_at on public.push_failures
  for each statement execute function public.cron_wake('pingo-push-retry');

drop trigger if exists cron_wake_master on public.ai_actions;
create trigger cron_wake_master after insert or update of status, run_at, undo, undo_at, expires_at on public.ai_actions
  for each statement execute function public.cron_wake('master-tick');

drop trigger if exists cron_wake_wipes on public.chat_wipes;
create trigger cron_wake_wipes after insert on public.chat_wipes
  for each statement execute function public.cron_wake('chat-wipes');

drop trigger if exists cron_wake_private on public.private_sessions;
create trigger cron_wake_private after insert or update of state, expires_at, ended_at on public.private_sessions
  for each statement execute function public.cron_wake('private-sweep');

-- Swap the every-minute schedules for armed ones (each job is removed now and re-created only when it has work).
select cron.unschedule(jobname) from cron.job where jobname in ('pingo-push-retry', 'master-tick', 'chat-wipes', 'private-sweep');
select public.cron_rearm_all();

-- Hourly safety net rides on the existing hourly notes-sweep job (no new job); the daily bookkeeping job keeps
-- 3 days of cron logs.
select cron.schedule('notes-sweep', '17 * * * *', 'select public.notes_sweep(); select public.cron_rearm_all();');
select cron.schedule('prune-bookkeeping', '17 3 * * *',
  'select public.prune_bookkeeping(); delete from cron.job_run_details where end_time < now() - interval ''3 days'';');
