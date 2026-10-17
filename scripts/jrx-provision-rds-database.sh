#!/usr/bin/env bash
# JRX-RDS-001 — create logical Postgres database `jurexio` on an EXISTING RDS instance.
# Does NOT migrate data from `jurexio` and does NOT alter Jurexio schemas.
#
# Required env (admin — from your secure store, never commit):
#   JRX_RDS_ADMIN_URL=postgres://<master_user>@<host>:5432/postgres?sslmode=verify-full
# Optional:
#   JRX_DB_NAME=jurexio
#   JRX_DB_USER=jurexio_app
#   JRX_DB_PASSWORD=...   (if unset, generates and prints length only at end)
#
# Requires: psql client, network path to RDS (VPN/bastion/SSM port-forward).
set -euo pipefail

DB_NAME="${JRX_DB_NAME:-jurexio}"
DB_USER="${JRX_DB_USER:-jurexio_app}"
ADMIN_URL="${JRX_RDS_ADMIN_URL:-}"

if [[ -z "$ADMIN_URL" ]]; then
  echo "Set JRX_RDS_ADMIN_URL (master connection to postgres maintenance DB)." >&2
  echo "Example SSM workflow (names only — fill values locally):" >&2
  echo "  aws ssm get-parameter --name /jurexio/prod/RDS_ADMIN_URL --with-decryption" >&2
  exit 1
fi

if [[ "$DB_NAME" == "jurexio" ]]; then
  echo "Refusing to target Jurexio database name jurexio." >&2
  exit 2
fi

if [[ -z "${JRX_DB_PASSWORD:-}" ]]; then
  JRX_DB_PASSWORD="$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)"
  GENERATED=1
else
  GENERATED=0
fi

echo "== Jurexio RDS provision: db=$DB_NAME user=$DB_USER =="

psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -c "SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'" | grep -q 1 \
  || psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -c "CREATE DATABASE ${DB_NAME};"

psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1 \
  || psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -c "CREATE ROLE ${DB_USER} LOGIN PASSWORD '$(printf '%s' "$JRX_DB_PASSWORD" | sed "s/'/''/g")';"

psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -c "GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};"

# Schema grants (connect to app DB — required for drizzle push)
psql "${ADMIN_URL/postgres/${DB_NAME}}" -v ON_ERROR_STOP=1 -c "GRANT ALL ON SCHEMA public TO ${DB_USER};"
psql "${ADMIN_URL/postgres/${DB_NAME}}" -v ON_ERROR_STOP=1 -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ${DB_USER};"

echo "== Database ensured (existence check via psql) =="
echo "Store app URL in SSM /jurexio/prod/DATABASE_URL (do not log the value)."
echo "Password length: ${#JRX_DB_PASSWORD} chars (generated=$GENERATED)"
echo "Run schema on Jurexio gateway host only:"
echo "  DATABASE_URL=<from-ssm> npm run db:push --force   # eyeball diff first"
echo "  npm run dev   # or container entrypoint migrate"
