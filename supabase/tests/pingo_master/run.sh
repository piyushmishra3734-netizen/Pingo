#!/usr/bin/env bash
# PINGO Master's rules, run against a throwaway Postgres with stubs for the
# Supabase pieces (auth.users, auth.uid(), pg_cron, the chat tables).
#
#   PGHOST=/tmp/pgtest PGPORT=55432 PGUSER=postgres supabase/tests/pingo_master/run.sh
#
# Read the output against the "---" headings in test.sql: each one says what
# should happen (refused, accepted, credits back, nothing written directly).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$here/../../.."
db="master_test_$$"
psql -q -d postgres -c "create database $db"
trap 'psql -q -d postgres -c "drop database $db"' EXIT
psql -q -d "$db" -v ON_ERROR_STOP=1 -f "$here/setup.sql"
psql -q -d "$db" -v ON_ERROR_STOP=1 -f "$root/supabase/migrations/20261029000000_ai_credits.sql" 2>/dev/null
psql -q -d "$db" -v ON_ERROR_STOP=1 -f "$root/supabase/migrations/20261106000000_pingo_master.sql"
psql -q -d "$db" -f "$here/test.sql"
