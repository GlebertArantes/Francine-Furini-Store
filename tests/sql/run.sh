#!/usr/bin/env bash
# Sobe um Postgres 16 descartável, aplica as migrations e roda tests/sql/t_*.sql.
# Uso: bash tests/sql/run.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PGBIN="$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)"
WORK="$(mktemp -d)"; chmod 755 "$WORK"
PORT=54329
RUN=(); [ "$(id -u)" = 0 ] && { chown postgres "$WORK"; RUN=(runuser -u postgres --); }
cleanup() { "${RUN[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
"${RUN[@]}" "$PGBIN/initdb" -D "$WORK/data" -U postgres -A trust >/dev/null
"${RUN[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=''" -l "$WORK/log" -w start >/dev/null
export PGHOST="$WORK" PGPORT=$PORT PGUSER=postgres
psql() { command psql -X -q -v ON_ERROR_STOP=1 "$@"; }
psql -d postgres -c "create database ff" 
export PGDATABASE=ff
chmod -R a+rX "$ROOT/tests" "$ROOT/supabase"
psql -f "$ROOT/tests/sql/00_stubs.sql"
for m in "$ROOT"/supabase/migrations/*.sql; do psql -f "$m"; done
fail=0
for t in "$ROOT"/tests/sql/t_*.sql; do
  echo "== $(basename "$t")"
  if ! psql -f "$t" 2>&1 | grep -v '^$'; then fail=1; fi
  [ "${PIPESTATUS[0]}" = 0 ] || fail=1
done
if [ -f "$ROOT/tests/sql/concurrency.sh" ]; then bash "$ROOT/tests/sql/concurrency.sh" || fail=1; fi
[ $fail = 0 ] && echo "TODOS OS TESTES SQL PASSARAM" || { echo "FALHAS"; exit 1; }
