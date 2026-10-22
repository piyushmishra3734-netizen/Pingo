#!/usr/bin/env bash
# ai_react against a throwaway Postgres with stubs. Expected, in order:
# 1 reacts (DM)  2 reacts to the tagged group message, not the newer untagged one
# 3 refuses an emoji off the list  4 a second react changes nothing (empty)
# 5 empty when the person switched reactions off.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
db="react_test_$$"
psql -q -d postgres -c "create database $db"
trap 'psql -q -d postgres -c "drop database $db"' EXIT
psql -q -d "$db" -f "$here/setup.sql" 2>/dev/null || true
psql -q -d "$db" -v ON_ERROR_STOP=1 -f "$here/../../migrations/20261107000000_ai_reactions.sql"
psql -q -d "$db" -f "$here/test.sql"
