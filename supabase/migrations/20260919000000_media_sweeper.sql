-- The collector that does not need anybody to open the app.
--
-- `20260918000000` parks objects the moment they have earned deletion, and the
-- uploader's own client deletes them on its next visit. That is the right
-- ordinary path - it keeps the property that no browser holds a credential
-- capable of deleting somebody else's media - and it has one hole: a person who
-- stops using PINGO. Their parked objects satisfy every rule and there is
-- nobody left to run the delete.
--
-- So the same two steps are also driven from the server: park, then delete.
-- This tick calls the `purge-media` Edge Function, which is the only place the
-- service role key lives and which decides nothing on its own - it reads what
-- has already been parked and calls the Storage API.
--
-- The arrangement is `push_retry_due`'s, deliberately: a secret in the vault, a
-- `pg_net` call, and `verify_jwt` off on the function because the caller is
-- Postgres and has no session. Least privilege for the same reason too - a
-- sweeper that only needs to delete parked objects should not carry a
-- credential that reads every table.

/*
 * The shared secret, generated here if it does not exist.
 *
 * Written into the vault rather than a table so it is encrypted at rest and
 * never shows up in a query somebody runs while looking at something else. Set
 * the same value on the function with:
 *
 *   supabase secrets set MEDIA_SWEEPER_SECRET=<value>
 */
do $$
declare
  existing text;
begin
  select decrypted_secret into existing
  from vault.decrypted_secrets
  where name = 'media_sweeper_secret';

  if existing is null then
    -- `gen_random_bytes` lives in pgcrypto, which is installed into the
    -- `extensions` schema here rather than `public`. Named explicitly so no
    -- search path can decide it for us.
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'media_sweeper_secret'
    );
  end if;
end
$$;

/*
 * One tick: park what has earned it, then ask the sweeper to delete it.
 *
 * Both halves here rather than two schedules, because the second is only ever
 * worth running after the first. `pg_net` is asynchronous, so this returns as
 * soon as the request is queued - the function's own log is where its outcome
 * lives, and a failed call costs an hour, not a leak.
 */
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
    url := 'https://lppzoqgvshhmxqsvggug.supabase.co/functions/v1/purge-media',
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

comment on function public.media_sweeper_tick is
  'Parks media that has earned deletion, then asks the purge-media Edge Function to remove the objects - including for senders who never open the app again.';

/*
 * Replaces the plain parking schedule from 20260918000000.
 *
 * That one only ever parked, which was correct while the client was the only
 * collector. Unscheduled by name rather than left alongside, so the two cannot
 * both run and race for the same rows.
 */
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('pingo-media-purge')
      where exists (select 1 from cron.job where jobname = 'pingo-media-purge');

    perform cron.unschedule('pingo-media-sweep')
      where exists (select 1 from cron.job where jobname = 'pingo-media-sweep');

    perform cron.schedule('pingo-media-sweep', '23 * * * *',
      $job$select public.media_sweeper_tick();$job$);
  end if;
end
$$;
