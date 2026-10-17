#!/usr/bin/env bash
# Master orchestrator — runs the migration SQL then all governance seeders.
# Idempotent. Safe to re-run.
set -euo pipefail

cd "$(dirname "$0")/.."

DB_URL="${DATABASE_URL:-${NYV_DATABASE_URL:-}}"
if [[ -z "$DB_URL" ]]; then
  echo "ERROR: DATABASE_URL (or NYV_DATABASE_URL) is required." >&2
  exit 1
fi
export DATABASE_URL="$DB_URL"

echo "── 1/6  Running migration SQL ──"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f scripts/migrations/2026-05-14-nv-governance-tables.sql

echo "── 2/6  Seeding compliance catalog (frameworks + controls) ──"
npx tsx scripts/jrx-seed-compliance-catalog.ts

echo "── 3/6  Seeding internal-security posture ──"
npx tsx scripts/jrx-seed-internal-security.ts

echo "── 4/6  Seeding canonical policies ──"
npx tsx scripts/jrx-seed-policies.ts

echo "── 5/6  Seeding HITL + RBAC + Regulatory feeds ──"
npx tsx scripts/jrx-seed-hitl-and-ops.ts

echo "── 6/6  Seeding per-org compliance evidence + assessments ──"
npx tsx scripts/jrx-seed-compliance-evidence.ts

echo
echo "✓ Governance seed complete."
