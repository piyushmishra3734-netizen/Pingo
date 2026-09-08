/*
 * Everything the move does not carry by itself.
 *
 * Run on the NEW project, after the schema and data are in. A dump moves tables,
 * functions, policies and grants. It does not move scheduled jobs, it does not
 * move secrets, and it has no idea that the old project's own address is sitting
 * both in three function bodies and in 28 rows - which is the failure on this
 * page that never announces itself, so it is done first.
 *
 * Safe to run twice.
 *
 * ## Before you run it
 *
 * Set the two secret values in section 3, and the new project ref at the top
 * of sections 1 and 2. They are the only thing here that
 * cannot be read out of the old project, by design: `vault.secrets` gives up
 * names, never values. Take them from wherever you keep them, or mint new ones -
 * they are shared secrets between the database and an edge function, so the only
 * requirement is that both sides say the same thing.
 */

-- ---------------------------------------------------------------------------
-- 1. The old project's address, baked into three function bodies
-- ---------------------------------------------------------------------------
/*
 * `on_notification_push`, `push_retry_due` and `media_sweeper_tick` each call an
 * edge function over `pg_net` at a full `https://<ref>.supabase.co/...` URL. A
 * restore brings those bodies across verbatim, so the new database keeps calling
 * the *old* project's functions. Nothing errors: `pg_net` posts, the old project
 * answers, and push quietly belongs to a database nobody is using any more.
 *
 * Rewritten by pattern rather than by naming the three, so a fourth added later
 * is caught too. The old ref is found in the bodies themselves - it does not
 * have to be typed - and the new one comes from `current_database()`'s project,
 * which on Supabase is not exposed, so it is the one value to fill in below.
 */
do $$
declare
  new_ref  text := 'gpijpmepzowwhvgkriqu';
  old_ref  text;
  fn       record;
  rewritten text;
  n        integer := 0;
begin
  if new_ref !~ '^[a-z]{20}$' then
    raise exception 'Set new_ref to the new project ref (20 lowercase letters, as in https://<ref>.supabase.co) before running this.';
  end if;

  select regexp_replace(p.prosrc, '.*https://([a-z]{20})\.supabase\.co.*', '\1')
    into old_ref
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosrc ~ 'https://[a-z]{20}\.supabase\.co'
   limit 1;

  if old_ref is null then
    raise notice 'No function embeds a project URL. Nothing to rewrite.';
    return;
  end if;

  if old_ref = new_ref then
    raise notice 'Functions already point at %. Nothing to rewrite.', new_ref;
    return;
  end if;

  for fn in
    select p.oid, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosrc like '%' || old_ref || '%'
  loop
    rewritten := replace(pg_get_functiondef(fn.oid), old_ref, new_ref);
    execute rewritten;
    n := n + 1;
    raise notice 'rewrote %', fn.proname;
  end loop;

  raise notice '% function(s) moved from % to %', n, old_ref, new_ref;
end $$;

-- ---------------------------------------------------------------------------
-- 2. The old project's address, stored in rows
-- ---------------------------------------------------------------------------
/*
 * The same trap as section 1, in data instead of code, and easier to miss
 * because nothing in the schema hints at it.
 *
 * 28 rows in the live database hold a full
 * `https://<ref>.supabase.co/storage/v1/object/...` URL rather than a path:
 * 19 profile avatars, 5 profile banners, a group's avatar, cover and wallpaper,
 * and one AI banner. Restored as-is they point at the old project's storage. If
 * that project is still up they keep working, which is worse than breaking -
 * the new app quietly serves pictures out of the old project until the day it
 * is deleted, and then 28 people lose their avatar at once.
 *
 * Rewritten across every text and json column rather than the six that hold
 * them today, so a column added later is covered without anybody remembering
 * this script exists.
 */
do $$
declare
  new_ref text := 'gpijpmepzowwhvgkriqu';
  old_ref text;
  c       record;
  hits    bigint;
  touched bigint;
  total   bigint := 0;
  targets text[][] := '{}';
  i       int;
begin
  if new_ref !~ '^[a-z]{20}$' then
    raise exception 'Set new_ref before running this section.';
  end if;

  /* Taken from the function bodies, so the old ref never has to be typed. */
  select substring(p.prosrc from 'https://([a-z]{20})[.]supabase[.]co')
    into old_ref
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosrc ~ 'https://[a-z]{20}[.]supabase[.]co'
   limit 1;

  if old_ref is null or old_ref = new_ref then
    raise notice 'No old ref to rewrite in rows.';
    return;
  end if;

  /*
   * Two passes, and the first one is the slow half.
   *
   * Every text and json column has to be looked at, because a URL can be
   * anywhere and guessing by column name is how the seventh one gets missed -
   * `messages.media_url` is a text column on 45,000 rows and holds paths today,
   * which is exactly the column a name-based filter would have skipped for
   * being obviously relevant, or included for being obviously large. So: count
   * first, and write only where there is something to write. On this data the
   * scan is the whole cost and the update touches 28 rows.
   */
  for c in
    select table_name, column_name, data_type
      from information_schema.columns
     where table_schema = 'public'
       and data_type in ('text', 'character varying', 'jsonb', 'json')
     order by table_name, column_name
  loop
    execute format(
      'select count(*) from public.%I where %I::text like %L',
      c.table_name, c.column_name, '%' || old_ref || '%'
    ) into hits;

    if hits > 0 then
      targets := targets || array[array[c.table_name, c.column_name, c.data_type]];
      raise notice 'found %.% - % row(s)', c.table_name, c.column_name, hits;
    end if;
  end loop;

  if array_length(targets, 1) is null then
    raise notice 'No stored URL holds the old ref. Nothing to rewrite.';
    return;
  end if;

  for i in 1 .. array_length(targets, 1) loop
    execute format(
      'update public.%I set %I = replace(%I::text, %L, %L)::%s where %I::text like %L',
      targets[i][1], targets[i][2], targets[i][2],
      old_ref, new_ref, targets[i][3],
      targets[i][2], '%' || old_ref || '%'
    );
    get diagnostics touched = row_count;
    total := total + touched;
  end loop;

  raise notice '% stored URL(s) moved from % to %', total, old_ref, new_ref;
end $$;

-- ---------------------------------------------------------------------------
-- 3. The two shared secrets
-- ---------------------------------------------------------------------------
/*
 * `push_trigger_secret` is what the notifications trigger presents to
 * `push-send`; `media_sweeper_secret` is the same arrangement for `purge-media`.
 * Each edge function checks the header against its own environment variable, so
 * whatever is set here has to be set there as well - see the runbook.
 *
 * Values are never read out of the old project. Vault hands back names and
 * descriptions; that is the point of it.
 */
do $$
declare
  push_secret  text := 'PUT-THE-PUSH-TRIGGER-SECRET-HERE';
  media_secret text := 'PUT-THE-MEDIA-SWEEPER-SECRET-HERE';
begin
  if push_secret like 'PUT-THE-%' or media_secret like 'PUT-THE-%' then
    raise exception 'Fill in both secrets before running this section.';
  end if;

  -- Replaced rather than added, so re-running does not leave two rows with the
  -- same name and a coin toss over which one the trigger reads.
  delete from vault.secrets where name in ('push_trigger_secret', 'media_sweeper_secret');

  perform vault.create_secret(push_secret, 'push_trigger_secret',
    'Shared secret the notifications trigger presents to push-send');
  perform vault.create_secret(media_secret, 'media_sweeper_secret',
    'Shared secret media_sweeper_tick presents to purge-media');

  raise notice 'Both secrets set.';
end $$;

-- ---------------------------------------------------------------------------
-- 4. The scheduled work
-- ---------------------------------------------------------------------------
/*
 * `cron.job` lives outside `public` and does not travel with a schema dump, so
 * a restored project has every sweep function and nothing calling them. The
 * symptom is slow rather than loud: media stops being purged, expired messages
 * stay, push retries never fire, and it all looks fine for a day.
 *
 * Unscheduled first so re-running does not double them up.
 */
do $$
declare
  jobs text[][] := array[
    ['pingo-push-retry',         '* * * * *',    'select public.push_retry_due();'],
    ['pingo-push-history',       '17 3 * * *',   'select public.push_prune_history();'],
    ['pingo-snap-purge',         '*/15 * * * *', 'select public.purge_expired_snaps();'],
    ['pingo-disappearing-sweep', '*/5 * * * *',  'select public.expire_messages();'],
    ['pingo-media-sweep',        '*/10 * * * *', 'select public.media_sweeper_tick();'],
    ['pingo-notification-prune', '41 3 * * *',   'select public.prune_message_notifications();'],
    ['pingo-device-key-prune',   '23 4 * * *',   'select public.prune_stale_device_keys();'],
    ['prune-bookkeeping',        '17 3 * * *',   'select public.prune_bookkeeping()']
  ];
  i integer;
begin
  for i in 1 .. array_length(jobs, 1) loop
    if exists (select 1 from cron.job where jobname = jobs[i][1]) then
      perform cron.unschedule(jobs[i][1]);
    end if;
    perform cron.schedule(jobs[i][1], jobs[i][2], jobs[i][3]);
  end loop;

  raise notice '% jobs scheduled', array_length(jobs, 1);
end $$;

-- ---------------------------------------------------------------------------
-- 5. Realtime
-- ---------------------------------------------------------------------------
/*
 * Six tables, and only six. The publication is what the client subscribes
 * through, so a table missing here is a screen that never updates until it is
 * reopened - and a table added here that nobody subscribes to is the egress
 * mistake `publish_what_is_subscribed` was written to undo.
 */
do $$
declare
  wanted text[] := array[
    'conversation_members', 'conversations', 'message_reactions',
    'messages', 'notifications', 'privacy_settings'
  ];
  t text;
  present text[];
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  foreach t in array wanted loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;

  select array_agg(tablename order by tablename) into present
    from pg_publication_tables
   where pubname = 'supabase_realtime' and schemaname = 'public';

  if present is distinct from (select array_agg(x order by x) from unnest(wanted) x) then
    raise notice 'Realtime publishes % - expected %',
      array_to_string(present, ', '), array_to_string(wanted, ', ');
    raise notice 'An extra table here is egress nobody asked for. Remove it with:';
    raise notice '  alter publication supabase_realtime drop table public.<name>;';
  else
    raise notice 'Realtime publishes the expected six tables.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6. What is still left for a person
-- ---------------------------------------------------------------------------
do $$
declare
  buckets int;
  objects int;
begin
  select count(*) into buckets from storage.buckets;
  select count(*) into objects from storage.objects;

  raise notice '--------------------------------------------------------------';
  raise notice 'Database side done. Storage here: % buckets, % objects.', buckets, objects;
  raise notice 'The source project had 8 buckets and 149 objects (89 MB).';
  raise notice '';
  raise notice 'Still outside this script:';
  raise notice '  - the 149 stored files themselves (bucket rows are not bytes)';
  raise notice '  - the 10 edge functions, and their environment variables';
  raise notice '  - the app''s own URL and publishable key, in the web build';
  raise notice '  - auth providers and redirect URLs, in the dashboard';
  raise notice '';
  raise notice 'Then run fingerprint.sql here and on the old project and compare.';
  raise notice '--------------------------------------------------------------';
end $$;
