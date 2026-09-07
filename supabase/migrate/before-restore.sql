/*
 * Run this on the NEW project first, before anything is restored into it.
 *
 * A schema dump refers to extensions but does not install them, and half of
 * PINGO's server side is extension-shaped: the sweeps are `pg_cron`, the push
 * trigger reaches the edge function over `pg_net`, invite codes and anchors use
 * `pgcrypto`, and the two shared secrets live in `supabase_vault`. Restoring
 * without these produces a wall of errors on objects that depend on them, and -
 * worse - a few that succeed while doing nothing.
 *
 * Safe to run twice.
 */

create extension if not exists "uuid-ossp"        with schema extensions;
create extension if not exists pgcrypto           with schema extensions;
create extension if not exists pg_stat_statements with schema extensions;
create extension if not exists pg_net             with schema extensions;
create extension if not exists pg_cron;
create extension if not exists supabase_vault     with schema vault;

/* What the old project had, so a version gap is visible rather than assumed. */
do $$
declare
  expected text[] := array[
    'pg_cron 1.6.4', 'pg_net 0.20.4', 'pg_stat_statements 1.11',
    'pgcrypto 1.3', 'supabase_vault 0.3.1', 'uuid-ossp 1.1'
  ];
  actual text[];
begin
  select array_agg(extname || ' ' || extversion order by extname)
    into actual
    from pg_extension
   where extname <> 'plpgsql';

  if actual is distinct from expected then
    raise notice 'Extension versions differ from the source project.';
    raise notice '  source: %', array_to_string(expected, ', ');
    raise notice '  here:   %', array_to_string(actual, ', ');
    raise notice 'Newer is usually fine. Older is not - check before restoring.';
  else
    raise notice 'Extensions match the source project.';
  end if;
end $$;
