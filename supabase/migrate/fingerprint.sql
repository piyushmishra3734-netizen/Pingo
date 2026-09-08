/*
 * One page that says whether two projects have the same shape.
 *
 * Run it on the old project, run it on the new one, put the two outputs side by
 * side. Every row is a category with a count and a digest: the count tells you
 * something is missing, the digest tells you something is *different*, which is
 * the failure a count cannot see - a policy that restored with a weaker `using`
 * clause, a function whose body lost a `security definer`, a column that came
 * back nullable.
 *
 * ## Why a digest and not a diff
 *
 * A real diff needs both databases open at once, which needs both passwords in
 * one place. This needs neither: it runs in each project's own SQL editor, and
 * two identical strings are the whole answer. When they differ, the queries
 * below the summary print the underlying rows so the difference can be found.
 *
 * ## The one thing deliberately normalised
 *
 * Three functions embed the project's own REST URL, so their text is *supposed*
 * to differ after the move. The ref is replaced with `<project-ref>` before
 * hashing, so a correctly rewritten function still matches - and a function
 * still pointing at the old project is caught by `after-restore.sql` instead,
 * which is the script whose job that is.
 *
 * Read the counts too, not just the digests. A digest matching on zero rows
 * means both sides are equally empty, which is a pass that proves nothing.
 */

with
/* Any project's own ref, so the digest does not depend on which project it is. */
norm as (
  select coalesce(
    (select regexp_replace(p.prosrc, '.*https://([a-z]{20})\.supabase\.co.*', '\1')
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosrc ~ 'https://[a-z]{20}\.supabase\.co'
      limit 1),
    'none'
  ) as ref
),

columns as (
  select c.table_name || '.' || c.column_name || ':' || c.data_type
         || ':' || c.is_nullable || ':' || coalesce(c.column_default, '-') as line
    from information_schema.columns c
   where c.table_schema = 'public'
),
constraints as (
  select c.relname || ':' || con.conname || ':' || pg_get_constraintdef(con.oid) as line
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
),
indexes as (
  select indexdef as line from pg_indexes where schemaname = 'public'
),
policies as (
  select tablename || ':' || policyname || ':' || cmd || ':' || roles::text
         || ':' || coalesce(qual, '-') || ':' || coalesce(with_check, '-') as line
    from pg_policies where schemaname = 'public'
),
rls as (
  select c.relname || ':' || c.relrowsecurity::text || ':' || c.relforcerowsecurity::text as line
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
),
functions as (
  select replace(pg_get_functiondef(p.oid), (select ref from norm), '<project-ref>') as line
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f'
),
triggers as (
  select pg_get_triggerdef(t.oid) as line
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and not t.tgisinternal
),
views as (
  select c.relname || ':' || pg_get_viewdef(c.oid, true)
         || ':' || coalesce(array_to_string(c.reloptions, ','), '-') as line
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('v', 'm')
),
/*
 * Table and column privileges together, read from the catalogue.
 *
 * This category earned its place twice over. Eight tables here are deliberately
 * narrower than the rest - `recovery_packages` is not selectable at all,
 * `device_keys` withholds `key_seen_at`, `profiles` allows UPDATE only through
 * ten named columns - and none of that shows up in any other category. A
 * restore that hands back a plain `GRANT ALL` passes every other check on this
 * page while leaving the account key material readable by every signed-in user.
 * That is not hypothetical: it is what happened, because `alter default
 * privileges ... grant all` on the target schema was applied before the restore
 * and a dump only ever GRANTs, it never revokes.
 *
 * It reads `pg_class.relacl` and `pg_attribute.attacl` rather than
 * `information_schema.*_privileges`, which was the first attempt and was
 * useless: those views only show grants involving roles the *reading* session
 * belongs to, so the same query returned 4,182 rows on one project and 0 on the
 * other. A category that silently reports nothing is worse than no category.
 *
 * The ACL entries are sorted before hashing because `relacl` is an array whose
 * order records when each grant was made - two databases with identical
 * privileges otherwise differ byte for byte.
 */
grants as (
  select c.relname
         || ' T[' || coalesce((select string_agg(x, ',' order by x)
                                 from unnest(c.relacl::text[]) x), '-') || ']'
         || ' C[' || coalesce((select string_agg(
                                  a.attname || ':' || (select string_agg(y, ',' order by y)
                                                         from unnest(a.attacl::text[]) y),
                                  ';' order by a.attname)
                                 from pg_attribute a
                                where a.attrelid = c.oid and a.attnum > 0
                                  and a.attacl is not null), '-') || ']' as line
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
),
realtime as (
  select schemaname || '.' || tablename as line from pg_publication_tables
   where pubname = 'supabase_realtime'
),
buckets as (
  select id || ':' || public::text || ':' || coalesce(file_size_limit::text, '-')
         || ':' || coalesce(array_to_string(allowed_mime_types, ','), '-') as line
    from storage.buckets
),
storage_policies as (
  select tablename || ':' || policyname || ':' || cmd
         || ':' || coalesce(qual, '-') || ':' || coalesce(with_check, '-') as line
    from pg_policies where schemaname = 'storage'
),
cron as (
  select jobname || ':' || schedule || ':' || command || ':' || active::text as line
    from cron.job
),
extensions as (
  select extname || ':' || extversion as line from pg_extension
),
everything as (
  select 'columns'          as category, line from columns
  union all select 'constraints',        line from constraints
  union all select 'indexes',            line from indexes
  union all select 'policies',           line from policies
  union all select 'rls enabled',        line from rls
  union all select 'functions',          line from functions
  union all select 'triggers',           line from triggers
  union all select 'views',              line from views
  union all select 'table+column acls',  line from grants
  union all select 'realtime tables',    line from realtime
  union all select 'storage buckets',    line from buckets
  union all select 'storage policies',   line from storage_policies
  union all select 'cron jobs',          line from cron
  union all select 'extensions',         line from extensions
)
select category,
       count(*) as items,
       md5(string_agg(line, E'\n' order by line)) as digest
  from everything
 group by category
 order by category;


/*
 * When a digest differs, run the matching block below on both projects and diff
 * the two outputs. Each returns the exact lines the digest was built from.
 *
 *   select tablename||':'||policyname||':'||cmd||':'||roles::text
 *          ||':'||coalesce(qual,'-')||':'||coalesce(with_check,'-')
 *     from pg_policies where schemaname='public' order by 1;
 *
 *   select c.relname, c.relacl,
 *          (select array_agg(a.attname||'='||a.attacl::text)
 *             from pg_attribute a
 *            where a.attrelid=c.oid and a.attnum>0 and a.attacl is not null)
 *     from pg_class c join pg_namespace n on n.oid=c.relnamespace
 *    where n.nspname='public' and c.relkind='r' order by 1;
 *
 *   select p.proname, pg_get_functiondef(p.oid)
 *     from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 *    where n.nspname='public' and p.prokind='f' order by 1;
 */
