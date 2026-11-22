-- Event-driven background jobs, part 2 (2026-11-22): the three message sweeps.
--
-- pingo-disappearing-sweep (every 5 min), pingo-media-sweep (every 10 min, plus an Edge Function call each time) and
-- pingo-snap-purge (every 15 min) ran 528 times a day with almost nothing to do. They now use the same arming as
-- part 1 (20261129000000_event_driven_cron.sql): a row trigger on messages arms the job for the minute the first
-- item is due; the job re-arms itself or disarms; the hourly cron_rearm_all() is the safety net.
-- The worker functions (expire_messages, media_sweeper_tick, purge_expired_snaps) are unchanged.
--
-- Media: expiring media is due at its media_expires_at; media that is already parked (deleted or expired, waiting
-- for the purge-media Edge Function to delete the bytes) is retried every 10 minutes while any is left, as before.

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
      (select min(expires_at)                  from public.private_sessions where state = 'active'),
      (select min(ended_at) + interval '1 day' from public.private_sessions where state = 'ended' and ended_at is not null)
    ) into d;
  elsif p_job = 'pingo-disappearing-sweep' then
    -- the same rows expire_messages() would touch
    select min(expires_at) into d from public.messages m
     where m.expires_at is not null and (m.body <> '' or m.envelope is not null or m.deleted_at is null);
  elsif p_job = 'pingo-media-sweep' then
    select least(
      (select min(media_expires_at) from public.messages
        where media_expires_at is not null and media_purge_path is null
          and coalesce(photo_path, file_path, voice_path) is not null),
      (select case when exists (select 1 from public.messages where media_purge_path is not null and media_purged_at is null)
              then now() + interval '10 minutes' end)
    ) into d;
  elsif p_job = 'pingo-snap-purge' then
    select min(snap_expires_at) into d from public.messages
     where kind = 'snap' and snap_path is not null and snap_expires_at is not null;
  else
    raise exception 'cron_next_due: unknown job %', p_job;
  end if;
  return d;
end;
$$;

create or replace function public.cron_run(p_job text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public.cron_lock(p_job);
  perform set_config('pingo.cron_worker', 'on', true);
  if p_job = 'pingo-push-retry' then perform public.push_retry_due();
  elsif p_job = 'master-tick' then perform public.master_tick();
  elsif p_job = 'chat-wipes' then perform public.run_chat_wipes();
  elsif p_job = 'private-sweep' then perform public.private_sweep();
  elsif p_job = 'pingo-disappearing-sweep' then perform public.expire_messages();
  elsif p_job = 'pingo-media-sweep' then perform public.media_sweeper_tick();
  elsif p_job = 'pingo-snap-purge' then perform public.purge_expired_snaps();
  else raise exception 'cron_run: unknown job %', p_job;
  end if;
  perform set_config('pingo.cron_worker', 'off', true);
  perform public.cron_arm(p_job, true);
  -- expiring a message parks its media; the media trigger was quiet during the run, so arm the media job here
  if p_job = 'pingo-disappearing-sweep' then
    perform public.cron_lock('pingo-media-sweep');
    perform public.cron_arm('pingo-media-sweep', false);
  end if;
end;
$$;

create or replace function public.cron_rearm_all()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare j text; a timestamptz;
begin
  foreach j in array array['pingo-push-retry', 'master-tick', 'chat-wipes', 'private-sweep',
                           'pingo-disappearing-sweep', 'pingo-media-sweep', 'pingo-snap-purge'] loop
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

revoke all on function public.cron_next_due(text), public.cron_run(text), public.cron_rearm_all() from public, anon, authenticated;

-- Row triggers with a WHEN filter: only messages that actually expire (or get parked media) pay for the check.
drop trigger if exists cron_wake_disappearing on public.messages;
create trigger cron_wake_disappearing after insert or update of expires_at on public.messages
  for each row when (new.expires_at is not null) execute function public.cron_wake('pingo-disappearing-sweep');

drop trigger if exists cron_wake_media_expiry on public.messages;
create trigger cron_wake_media_expiry after insert or update of media_expires_at on public.messages
  for each row when (new.media_expires_at is not null) execute function public.cron_wake('pingo-media-sweep');

drop trigger if exists cron_wake_media_parked on public.messages;
create trigger cron_wake_media_parked after update of media_purge_path on public.messages
  for each row when (new.media_purge_path is not null) execute function public.cron_wake('pingo-media-sweep');

drop trigger if exists cron_wake_snap on public.messages;
create trigger cron_wake_snap after insert or update of snap_expires_at on public.messages
  for each row when (new.snap_expires_at is not null) execute function public.cron_wake('pingo-snap-purge');

select cron.unschedule(jobname) from cron.job where jobname in ('pingo-disappearing-sweep', 'pingo-media-sweep', 'pingo-snap-purge');
select public.cron_rearm_all();
