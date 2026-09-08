#!/usr/bin/env bash
#
# Step 3 of the runbook, as one command.
#
# Asks for the two database passwords, dumps the old project, restores into the
# new one, and counts the rows on both sides before and after so the result is
# checked rather than assumed.
#
#   bash supabase/migrate/dump-restore.sh
#
# Nothing else to assemble: it prompts for each password without echoing it.
# `OLD_PASSWORD` / `NEW_PASSWORD` in the environment still override the prompts
# if it ever needs to run unattended.
#
# ## Why the passwords are not in a connection URI
#
# A URI has to be percent-encoded, so a password containing `@`, `/`, `#` or `?`
# silently connects somewhere else or fails with an error about the wrong host.
# `PGPASSWORD` takes the value verbatim, and the host, user and database are
# separate flags - nothing to encode, nothing to get wrong.
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

#
# Asked for rather than required on the command line.
#
# A password passed as `OLD_PASSWORD=... bash script.sh` goes into the shell
# history and sits there in plain text. `read -s` does not echo it, does not
# store it, and means the whole of running this is typing one line and then a
# password - which is one fewer thing to assemble correctly at the moment it
# matters least.
#
if [ -z "${OLD_PASSWORD:-}" ]; then
  read -rsp "Old project (${OLD_REF}) database password: " OLD_PASSWORD
  echo
fi
if [ -z "${NEW_PASSWORD:-}" ]; then
  read -rsp "New project (${NEW_REF}) database password: " NEW_PASSWORD
  echo
fi

if [ -z "$OLD_PASSWORD" ] || [ -z "$NEW_PASSWORD" ]; then
  echo "Both passwords are needed." >&2
  exit 1
fi
echo

mkdir -p "$OUT"

#
# Resolved once for each project: "host user" for whichever route answers.
#
# Every candidate is tried and the reason each one refused is kept. The first
# version of this said only "could not reach it, check the password", which is
# one guess out of several: a wrong password, an unreachable host, and a pooler
# on a different cluster all look identical from outside and have nothing to do
# with one another. Errors are collected in a file rather than printed as they
# happen, so a run that succeeds on a later candidate stays quiet.
#
# Direct comes first. Free projects answer on IPv6 only at
# `db.<ref>.supabase.co`, so on an IPv4-only network it is unreachable however
# right the password is. After that the session pooler, whose cluster number is
# part of its hostname and is *not* the same for every project - so both are
# tried rather than assuming this project sits wherever the last one did. The
# transaction pooler on 6543 is never used: it cannot hold the session state a
# dump or a restore needs.
#
ROUTE_ERRORS="$(mktemp)"
trap 'rm -f "$ROUTE_ERRORS"' EXIT

route() {
  local ref="$1" password="$2"
  local host user err candidate

  for candidate in "db.$ref.supabase.co postgres" \
                   "aws-0-$REGION.pooler.supabase.com postgres.$ref" \
                   "aws-1-$REGION.pooler.supabase.com postgres.$ref"; do
    read -r host user <<<"$candidate"
    if err=$(PGPASSWORD="$password" "$PSQL" -h "$host" -p 5432 -U "$user" \
               -d postgres -Atc 'select 1' 2>&1); then
      echo "$host $user"
      return
    fi
    {
      echo "  $host (as $user)"
      echo "$err" | grep -v '^[[:space:]]*$' | head -2 | sed 's/^/    /'
    } >>"$ROUTE_ERRORS"
  done

  echo "" ""
}

echo "Finding a route to each project..."
read -r OLD_HOST OLD_USER <<<"$(route "$OLD_REF" "$OLD_PASSWORD")"
read -r NEW_HOST NEW_USER <<<"$(route "$NEW_REF" "$NEW_PASSWORD")"

if [ -z "$OLD_HOST" ] || [ -z "$NEW_HOST" ]; then
  [ -z "$OLD_HOST" ] && echo "Could not reach the OLD project ($OLD_REF)." >&2
  [ -z "$NEW_HOST" ] && echo "Could not reach the NEW project ($NEW_REF)." >&2
  echo >&2
  echo "What each route said:" >&2
  cat "$ROUTE_ERRORS" >&2
  echo >&2
  echo 'A line saying "password authentication failed" means the password is wrong.' >&2
  echo "Anything about the host or the network means it is not reachable from here." >&2
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
# Named explicitly rather than parsed out of `ls`: the path contains a space,
# so awk's $9 printed "/e/Pingo" for all three and the sizes could not be told
# apart. `ls` also sorts, so the order was not the order they were written in.
for f in public auth buckets; do
  printf '  %-12s %s\n' "$f.sql" "$(du -h "$OUT/$f.sql" | cut -f1)"
done

# A schema-only dump of this database is a few hundred KB; a real one is tens of
# megabytes, and it restores perfectly into an empty project either way. That is
# the failure that looks like success, so it is caught here.
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
  log="$OUT/$f.restore.log"

  PGPASSWORD="$NEW_PASSWORD" "$PSQL" -h "$NEW_HOST" -p 5432 -U "$NEW_USER" -d postgres \
    -v ON_ERROR_STOP=0 -f "$OUT/$f.sql" >"$log" 2>&1 || true

  #
  # psql prefixes every error with the file and line it came from, so a real one
  # reads `psql:public.sql:60103: ERROR: ...` and never begins at column zero.
  # The first version of this grepped for `^ERROR`, matched nothing, and printed
  # a clean restore over one where the largest table had failed entirely - the
  # same swallowed-error shape this migration exists to avoid. The full output
  # is now kept on disk either way.
  #
  errors=$(grep -cE '(ERROR|FATAL):' "$log" || true)
  if [ "$errors" -gt 0 ]; then
    echo "  $errors error line(s). Full output: $log"
    grep -E '(ERROR|FATAL):' "$log" | head -15 | sed 's/^/    /'
    [ "$errors" -gt 15 ] && echo "    ... and $((errors - 15)) more in the log"
  else
    echo "  no errors"
  fi
done

echo
echo "NEW, after the restore:"
echo "  $(on_new "$COUNTS")"
echo "OLD, for comparison:"
echo "  $AFTER"
echo
echo "If those two lines match, step 3 is done. Next: after-restore.sql."
