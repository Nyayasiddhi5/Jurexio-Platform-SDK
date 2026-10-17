#!/usr/bin/env bash
# nv-check-schema-drift.sh — NV-SCHEMA-DRIFT-001 wrapper
#
# Spins up an empty embedded Postgres, applies every checked-in migration in
# order (drizzle/000*.sql + nyayavigya-platform-312/migrations/*.sql), then
# compares the resulting schema against the Drizzle TS exports listed in
# drizzle.config.ts. Fails when a column/type/NOT NULL/default declared in TS
# is missing from the migrations — the failure mode that produced tasks #263
# and #265.
#
# Run:  bash scripts/jrx-check-schema-drift.sh
# CI:   npm run guardrail:schema-drift
#
# Soft mode (report drift but exit 0):
#   npm run guardrail:schema-drift -- --warn-only
#
# Skip in environments without Postgres binaries (initdb / pg_ctl) — the
# guardrail is a no-op there with a loud warning so it does not silently
# pass on a malformed CI runner.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MISSING=()
for bin in initdb pg_ctl psql; do
  command -v "$bin" >/dev/null 2>&1 || MISSING+=("$bin")
done
if [ "${#MISSING[@]}" -gt 0 ]; then
  echo "  ✗ NV-SCHEMA-DRIFT-001: missing PostgreSQL binaries on PATH: ${MISSING[*]}"
  echo "    This guardrail spins up a throwaway Postgres to apply every"
  echo "    checked-in migration and diff against shared/**. Without the"
  echo "    binaries it cannot run, and silently passing would defeat the"
  echo "    purpose (a CI runner with no Postgres would let drift through)."
  echo ""
  echo "    Install them:"
  echo "      • Replit/Nix: postgresql is in replit.nix already — restart the shell."
  echo "      • CI runner:  use a postgres service container, or apt-get install postgresql-client postgresql."
  echo ""
  echo "    Last-resort override for genuinely Postgres-less environments"
  echo "    (e.g. a bare doc-only build job):"
  echo "      NYV_DRIFT_TOLERATE_NO_PG=1 npm run guardrail:schema-drift"
  if [ "${NYV_DRIFT_TOLERATE_NO_PG:-0}" = "1" ]; then
    echo ""
    echo "  ⚠ NYV_DRIFT_TOLERATE_NO_PG=1 set — skipping (drift not verified)."
    exit 0
  fi
  exit 2
fi

exec npx tsx "$ROOT/scripts/jrx-check-schema-drift.ts" "$@"
