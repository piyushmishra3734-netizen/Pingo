#!/usr/bin/env bash
#
# Step 3 of the runbook, as one command.
#
# Takes the two database passwords from the environment, dumps the old project,
# restores into the new one, and counts the rows on both sides before and after
# so the result is checked rather than assumed.
#
#   OLD_PASSWORD='...' NEW_PASSWORD='...' bash supabase/migrate/dump-restore.sh
#
# ## Why the passwords are not in a connection URI
#
# A URI has to be percent-encoded, so a password containing `@`, `/`, `#` or `?`
# silently connects somewhere else or fails with an error about the wrong host.
# `PGPASSWORD` takes the value verbatim, and the host, user and database are
# separate flags - nothing to encode, nothing to get wrong.
#
# ## Which host
#
# Direct first. Free projects answer on IPv6 only at `db.<ref>.supabase.co`, so
# on an IPv4-only network it does not resolve at all; the script tries one
# trivial query and falls back to the session pooler, where the username is
# `postgres.<ref>` rather than `postgres`. The transaction pooler on 6543 is
# never used - it cannot hold the session state a dump or a restore needs.
#
# ## What it does not do
#
# It does not run `after-restore.sql`, copy storage, or deploy edge functions.
# Those are separate on purpose: this is the part that must happen in one
# sitting against a database nobody is writing to, and the rest can be done at
# leisure afterwards.

set -euo pipefail

OLD_REF='lppzoqgvshhmxqsvggug'
NEW_REF='gpijpmepzowwhvgkriqu'
REGION='ap-south-1'

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN="$HERE/../../.tools/pgsql/bin"
OUT="$HERE/../../.tools/dump"

PG_DUMP="$BIN/pg_dump"
PSQL="$BIN/psql"

for tool in "$PG_DUMP" "$PSQL"; do
  if [ ! -x "$tool" ] && [ ! -x "$tool.exe" ]; then
    echo "Missing $tool - the PostgreSQL 17 client binaries are not in .tools/pgsql." >&2
    exit 1
  fi
done

: "${OLD_PASSWORD:?Set OLD_PASSWORD to the old project's database password}"
: "${NEW_PASSWORD:?Set NEW_PASSWORD to the new project's database password}"

mkdir -p "$OUT"

# Resolved once for each project: "host user" for whichever route answers.
route() {
  local ref="$1" password="$2"
  local direct_host="db.$ref.supabase.co"
  local pooler_host="aws-1-$REGION.pooler.supabase.com"

  if PGPASSWORD="$password" "$PSQL" -h "$direct_host" -p 5432 -U postgres \
       -d postgres -Atc 'select 1' >/dev/null 2>&1; then
    echo "$direct_host postgres"
  elif PGPASSWORD="$password" "$PSQL" -h "$pooler_host" -p 5432 -U "postgres.$ref" \
       -d postgres -Atc 'select 1' >/dev/null 2>&1; then
    echo "$pooler_host postgres.$ref"
  else
    echo "" ""
  fi
}

echo "Finding a route to each project..."
read -r OLD_HOST OLD_USER <<<"$(route "$OLD_REF" "$OLD_PASSWORD")"
read -r NEW_HOST NEW_USER <<<"$(route "$NEW_REF" "$NEW_PASSWORD")"

if [ -z "$OLD_HOST" ]; then
  echo "Could not reach the OLD project on either route. Check OLD_PASSWORD." >&2
  exit 1
fi
if [ -z "$NEW_HOST" ]; then
  echo "Could not reach the NEW project on either route. Check NEW_PASSWORD." >&2
  exit 1
fi
echo "  old: $OLD_USER@$OLD_HOST"
echo "  new: $NEW_USER@$NEW_HOST"
echo

COUNTS="select 'accounts='||(select count(*) from auth.users)
       ||' messages='||(select count(*) from public.messages)
       ||' conversations='||(select count(*) from public.conversations)
       ||' members='||(select count(*) from public.conversation_members)
       ||' device_keys='||(select count(*) from public.device_keys)
       ||' files='||(select count(*) from storage.objects)
       ||' newest='||coalesce((select max(created_at)::text from public.messages),'-')"

on_old() { PGPASSWORD="$OLD_PASSWORD" "$PSQL" -h "$OLD_HOST" -p 5432 -U "$OLD_USER" -d postgres -Atc "$1"; }
on_new() { PGPASSWORD="$NEW_PASSWORD" "$PSQL" -h "$NEW_HOST" -p 5432 -U "$NEW_USER" -d postgres -Atc "$1"; }

echo "OLD, before the dump:"
BEFORE="$(on_old "$COUNTS")"
echo "  $BEFORE"
echo

echo "Dumping..."
PGPASSWORD="$OLD_PASSWORD" "$PG_DUMP" -h "$OLD_HOST" -p 5432 -U "$OLD_USER" -d postgres \
  --schema=public --no-owner -f "$OUT/public.sql"
PGPASSWORD="$OLD_PASSWORD" "$PG_DUMP" -h "$OLD_HOST" -p 5432 -U "$OLD_USER" -d postgres \
  --data-only --no-owner --table=auth.users --table=auth.identities -f "$OUT/auth.sql"
PGPASSWORD="$OLD_PASSWORD" "$PG_DUMP" -h "$OLD_HOST" -p 5432 -U "$OLD_USER" -d postgres \
  --data-only --no-owner --table=storage.buckets -f "$OUT/buckets.sql"

echo
ls -lh "$OUT"/public.sql "$OUT"/auth.sql "$OUT"/buckets.sql | awk '{print "  "$9"  "$5}'

# A schema-only dump of this database is a few hundred KB; a real one is tens of
# megabytes. Catching that here beats discovering it after the restore "worked".
size=$(wc -c <"$OUT/public.sql")
if [ "$size" -lt 10000000 ]; then
  echo
  echo "public.sql is only $size bytes. That is schema without data - stopping." >&2
  exit 1
fi

echo
echo "OLD, after the dump:"
AFTER="$(on_old "$COUNTS")"
echo "  $AFTER"
if [ "$BEFORE" != "$AFTER" ]; then
  echo
  echo "The database changed while it was being dumped:" >&2
  echo "  before: $BEFORE" >&2
  echo "  after:  $AFTER" >&2
  echo "Somebody is still writing. Wait for it to go quiet and run this again." >&2
  exit 1
fi
echo "  unchanged - the dump is a clean line."
echo

echo "Restoring into the new project..."
echo "Errors mentioning auth, storage, roles or extensions are expected."
echo "An error on a public object is not - read them."
echo
for f in public auth buckets; do
  echo "--- $f.sql"
  PGPASSWORD="$NEW_PASSWORD" "$PSQL" -h "$NEW_HOST" -p 5432 -U "$NEW_USER" -d postgres \
    -v ON_ERROR_STOP=0 -f "$OUT/$f.sql" 2>&1 | grep -E '^(ERROR|FATAL)' | sort | uniq -c | sort -rn || true
done

echo
echo "NEW, after the restore:"
echo "  $(on_new "$COUNTS")"
echo "OLD, for comparison:"
echo "  $AFTER"
echo
echo "If those two lines match, step 3 is done. Next: after-restore.sql."
