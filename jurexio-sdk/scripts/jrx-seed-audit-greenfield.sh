#!/usr/bin/env bash
# JRX-AUDIT-GREENFIELD-001 — bootstrap nv_audit_logs genesis on empty RDS.
#
# Use after db:push on a greenfield host that temporarily sets
# JRX_AUDIT_CHAIN_TOLERATE=1 in /opt/Jurexio/secrets/.env.production so the
# gateway can boot before the hash-chain head exists.
#
# Requires DATABASE_URL or JRX_DATABASE_URL (loads .env in repo root when present).
#
# Post-run (operator, on EC2 — no secret values in logs):
#   1. Confirm gateway boot without [JRX-NS-010] abort.
#   2. Remove the line JRX_AUDIT_CHAIN_TOLERATE=1 from host secrets, redeploy or
#      docker compose up -d --force-recreate gateway.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ -z "${DATABASE_URL:-}" ] && [ -z "${JRX_DATABASE_URL:-}" ]; then
  if [ -f .env ]; then
    set -a
    # shellcheck disable=SC1091
    source .env
    set +a
  fi
fi

export DATABASE_URL="${DATABASE_URL:-${JRX_DATABASE_URL:?set DATABASE_URL or JRX_DATABASE_URL}}"

echo "==> [audit-greenfield] demo org (idempotent)"
npx tsx scripts/jrx-seed-organizations.ts

echo "==> [audit-greenfield] RAG namespaces + nv_audit_logs genesis (JRX-NS-004)"
npx tsx scripts/jrx-seed-rag-and-audit.ts

SECRETS_HINT="${JRX_SECRETS_FILE:-/opt/Jurexio/secrets/.env.production}"
echo "==> [audit-greenfield] done — remove JRX_AUDIT_CHAIN_TOLERATE=1 from ${SECRETS_HINT} and recreate gateway when health is green"
