#!/usr/bin/env bash
# =============================================================================
# migrate-to-managed-datastores.sh — Task #17 cutover runbook
#
# One-shot migration of the dev EC2 (jrx-prod) from container-local
# Postgres/Redis to AWS RDS Postgres + ElastiCache Redis. Run this *on the
# jrx-prod EC2 box* (or via the Replit shell using `ssh ubuntu@jrx-prod '...'`)
# inside a planned 15–30 min maintenance window.
#
# Prerequisites (verified by --preflight):
#   1. Terraform applied in envs/dev-edge with `enable_managed_datastores=true`.
#      RDS + ElastiCache endpoints exist and the SGs already allow the jrx-prod SG.
#   2. awscli + jq + docker + psql (postgres-client) present on the EC2 box.
#      psql 16 installs with: `sudo apt-get install -y postgresql-client-16`.
#   3. The instance role (or AWS_PROFILE) can read secretsmanager for the two
#      new secrets: `jrx-dev-edge-pg/rds/master`, `jrx-dev-edge-redis/redis/auth`.
#   4. Container Postgres is named `jrx-postgres` and Redis is named `jrx-redis`
#      (verify with: `docker ps --filter name=jrx-`).
#
# Phases:
#   --preflight   verify prerequisites (no writes)
#   --dump        pg_dump from jrx-postgres -> /opt/nyayavigya/migration/<ts>.sql
#   --restore     psql restore the dump into RDS (runs inside `jrx-pg-migrator`
#                 ephemeral container so we don't need psql on the host)
#   --cutover     rewrite .env (DATABASE_URL / JRX_REDIS_TCP_URL / REDIS_URL),
#                 docker compose up -d (forces gateway recreate), verify /health,
#                 then `docker stop jrx-postgres jrx-redis` + `docker rm`.
#   --rollback    restore .env.pre-rds (created by --cutover), restart
#                 jrx-postgres + jrx-redis, recreate gateway containers.
#   --all         preflight -> dump -> restore -> cutover (default)
#
# This script is intentionally idempotent: each phase records a marker file in
# /opt/nyayavigya/migration/state and skips itself if already done. To re-run a
# phase, delete its marker.
# =============================================================================
set -euo pipefail

REGION="${AWS_REGION:-ap-south-1}"
RDS_SECRET="${JRX_RDS_SECRET:-jrx-dev-edge-pg/rds/master}"
REDIS_SECRET="${JRX_REDIS_SECRET:-jrx-dev-edge-redis/redis/auth}"
PG_CONTAINER="${JRX_PG_CONTAINER:-jrx-postgres}"
REDIS_CONTAINER="${JRX_REDIS_CONTAINER:-jrx-redis}"
PG_USER_LOCAL="${JRX_PG_USER_LOCAL:-nyv}"
PG_DB_LOCAL="${JRX_PG_DB_LOCAL:-nyayavigya}"
ENV_FILE="${JRX_ENV_FILE:-/opt/nyayavigya/current/.env}"
COMPOSE_FILE="${JRX_COMPOSE_FILE:-/opt/nyayavigya/current/docker-compose.ecosystem.yml}"
WORK_DIR="${JRX_MIGRATION_DIR:-/opt/nyayavigya/migration}"
STATE_DIR="$WORK_DIR/state"
HEALTH_URL="${JRX_HEALTH_URL:-http://127.0.0.1/health}"

LOG()  { printf "[migrate-managed] %s\n" "$*" >&2; }
DIE()  { LOG "FATAL: $*"; exit 1; }
DONE() { touch "$STATE_DIR/$1"; LOG "phase $1 marked complete"; }
HAS()  { [ -f "$STATE_DIR/$1" ]; }

mkdir -p "$WORK_DIR" "$STATE_DIR"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || DIE "missing dependency: $1"
}

# --- helpers ----------------------------------------------------------------

aws_secret_json() {
  aws secretsmanager get-secret-value --region "$REGION" \
    --secret-id "$1" --query SecretString --output text
}

rds_url_from_secret() {
  local s; s=$(aws_secret_json "$RDS_SECRET")
  local user host port db pw
  user=$(echo "$s" | jq -r .username)
  host=$(echo "$s" | jq -r .host)
  port=$(echo "$s" | jq -r .port)
  db=$(echo "$s"   | jq -r .dbname)
  pw=$(echo "$s"   | jq -r .password)
  # URL-encode the password (safe set of metacharacters)
  pw_enc=$(jq -rn --arg s "$pw" '$s|@uri')
  printf 'postgres://%s:%s@%s:%s/%s?sslmode=require' \
    "$user" "$pw_enc" "$host" "$port" "$db"
}

redis_url_from_secret() {
  local s; s=$(aws_secret_json "$REDIS_SECRET")
  local host port token
  host=$(echo "$s"  | jq -r .host)
  port=$(echo "$s"  | jq -r .port)
  token=$(echo "$s" | jq -r .auth_token)
  token_enc=$(jq -rn --arg s "$token" '$s|@uri')
  # ElastiCache transit_encryption_enabled = true => rediss:// (TLS)
  printf 'rediss://:%s@%s:%s/0' "$token_enc" "$host" "$port"
}

# --- phases -----------------------------------------------------------------

phase_preflight() {
  HAS preflight && { LOG "preflight already done"; return; }
  LOG "phase: preflight"
  # Tools used across phases — fail early so the operator gets one error,
  # not three retries. `timeout` + /dev/tcp is used for the SG reachability
  # probe, `python3` for the .env rewrite, `gunzip` for the dump pipe.
  for c in aws jq docker curl python3 timeout gunzip gzip; do require_cmd "$c"; done
  [ -f "$ENV_FILE" ] || DIE "env file not found at $ENV_FILE (set JRX_ENV_FILE)"
  [ -f "$COMPOSE_FILE" ] || DIE "compose file not found at $COMPOSE_FILE"
  docker inspect "$PG_CONTAINER" >/dev/null 2>&1 \
    || DIE "container $PG_CONTAINER not running (JRX_PG_CONTAINER overrides)"
  docker inspect "$REDIS_CONTAINER" >/dev/null 2>&1 \
    || LOG "WARN: container $REDIS_CONTAINER not running — proceeding (cache only)"
  # Resolve secrets (also acts as IAM check).
  rds_url_from_secret >/dev/null || DIE "cannot read RDS secret $RDS_SECRET"
  redis_url_from_secret >/dev/null || DIE "cannot read Redis secret $REDIS_SECRET"
  # Sanity: RDS reachable from this box (attempts a TCP connect via /dev/tcp).
  RDS_HOST=$(aws_secret_json "$RDS_SECRET" | jq -r .host)
  REDIS_HOST=$(aws_secret_json "$REDIS_SECRET" | jq -r .host)
  timeout 5 bash -c "</dev/tcp/$RDS_HOST/5432" \
    || DIE "RDS $RDS_HOST:5432 not reachable from jrx-prod — check SG ingress."
  timeout 5 bash -c "</dev/tcp/$REDIS_HOST/6379" \
    || DIE "Redis $REDIS_HOST:6379 not reachable from jrx-prod — check SG ingress."
  DONE preflight
}

phase_dump() {
  HAS dump && { LOG "dump already done"; return; }
  LOG "phase: dump from container Postgres ($PG_CONTAINER)"
  local ts; ts=$(date -u +%Y%m%dT%H%M%SZ)
  local out="$WORK_DIR/${ts}-${PG_DB_LOCAL}.sql.gz"
  # `-i` (no `-t`) so this works under non-interactive SSH (`ssh ... 'bash -s'`)
  # where there is no TTY — `-t` would fail with "the input device is not a TTY".
  docker exec -i "$PG_CONTAINER" \
    pg_dump -U "$PG_USER_LOCAL" -d "$PG_DB_LOCAL" \
    --no-owner --no-privileges --clean --if-exists \
    | gzip -9 > "$out"
  ls -lh "$out" >&2
  ln -sfn "$out" "$WORK_DIR/latest.sql.gz"
  DONE dump
}

phase_restore() {
  HAS restore && { LOG "restore already done"; return; }
  LOG "phase: restore into RDS"
  [ -f "$WORK_DIR/latest.sql.gz" ] || DIE "no dump found at $WORK_DIR/latest.sql.gz"
  local rds_url; rds_url=$(rds_url_from_secret)
  # Run psql inside an ephemeral postgres:16-alpine so we don't depend on
  # host-side psql being installed.
  gunzip -c "$WORK_DIR/latest.sql.gz" | \
    docker run -i --rm \
      -e PGURL="$rds_url" \
      postgres:16-alpine \
      sh -c 'psql "$PGURL" -v ON_ERROR_STOP=1 -1 -f -'
  DONE restore
}

phase_cutover() {
  HAS cutover && { LOG "cutover already done"; return; }
  LOG "phase: cutover .env + restart gateway containers"
  cp -a "$ENV_FILE" "${ENV_FILE}.pre-rds.$(date -u +%Y%m%dT%H%M%SZ)"
  cp -a "$ENV_FILE" "${ENV_FILE}.pre-rds"     # latest pointer for --rollback
  local db_url r_url
  db_url=$(rds_url_from_secret)
  r_url=$(redis_url_from_secret)
  # Use python to do safe in-place edit (preserves comments + adds missing keys).
  python3 - "$ENV_FILE" "$db_url" "$r_url" <<'PY'
import sys, re, pathlib
path, db_url, r_url = sys.argv[1], sys.argv[2], sys.argv[3]
overrides = {
  "DATABASE_URL": db_url,
  "JRX_REDIS_TCP_URL": r_url,
  "REDIS_URL": r_url,
}
src = pathlib.Path(path).read_text().splitlines(True)
seen = set()
out = []
for line in src:
  m = re.match(r'^(\s*)([A-Z0-9_]+)\s*=', line)
  if m and m.group(2) in overrides:
    out.append(f"{m.group(1)}{m.group(2)}={overrides[m.group(2)]}\n")
    seen.add(m.group(2))
  else:
    out.append(line)
for k, v in overrides.items():
  if k not in seen:
    out.append(f"{k}={v}\n")
pathlib.Path(path).write_text(''.join(out))
PY
  LOG "rewrote $ENV_FILE — DATABASE_URL/JRX_REDIS_TCP_URL/REDIS_URL now point at managed endpoints"

  # Force-recreate every gateway-* service in the ecosystem compose so they pick
  # up the new env. Keep jrx-postgres / jrx-redis containers running until the
  # health check passes — we tear them down only on success.
  ( cd "$(dirname "$COMPOSE_FILE")" && \
    sg docker -c "docker compose -f $(basename "$COMPOSE_FILE") --env-file .env up -d --force-recreate gateway-a gateway-b" )

  LOG "waiting for /health on $HEALTH_URL (up to 120s)"
  ok=0
  for i in $(seq 1 24); do
    code=$(curl -s -o /dev/null -w '%{http_code}' -m 5 "$HEALTH_URL" || echo 000)
    if [ "$code" = "200" ]; then ok=1; break; fi
    printf "  [%2ds] %s\n" $((i*5)) "$code"
    sleep 5
  done
  if [ "$ok" != "1" ]; then
    LOG "health gate FAILED — keeping jrx-postgres + jrx-redis up. Run --rollback to revert."
    exit 1
  fi

  LOG "health OK — stopping legacy datastore containers"
  for c in "$PG_CONTAINER" "$REDIS_CONTAINER"; do
    if docker inspect "$c" >/dev/null 2>&1; then
      docker stop "$c" >/dev/null
      LOG "stopped $c"
    fi
  done
  LOG "leaving stopped containers in place (volumes intact) — remove with:
    docker rm $PG_CONTAINER $REDIS_CONTAINER
  once you've verified RDS retains data correctly for at least 24 h."
  DONE cutover
}

phase_rollback() {
  LOG "phase: rollback to container Postgres + Redis"
  [ -f "${ENV_FILE}.pre-rds" ] || DIE "no .env.pre-rds backup found — cannot auto-rollback"
  cp -a "${ENV_FILE}.pre-rds" "$ENV_FILE"
  for c in "$PG_CONTAINER" "$REDIS_CONTAINER"; do
    if docker inspect "$c" >/dev/null 2>&1; then
      docker start "$c" >/dev/null && LOG "started $c"
    fi
  done
  ( cd "$(dirname "$COMPOSE_FILE")" && \
    sg docker -c "docker compose -f $(basename "$COMPOSE_FILE") --env-file .env up -d --force-recreate gateway-a gateway-b" )
  rm -f "$STATE_DIR/cutover" "$STATE_DIR/restore"
  LOG "rollback done — verify with: curl -s $HEALTH_URL"
}

# --- entrypoint -------------------------------------------------------------

case "${1:---all}" in
  --preflight) phase_preflight ;;
  --dump)      phase_preflight; phase_dump ;;
  --restore)   phase_preflight; phase_restore ;;
  --cutover)   phase_preflight; phase_cutover ;;
  --rollback)  phase_rollback ;;
  --all)       phase_preflight; phase_dump; phase_restore; phase_cutover ;;
  -h|--help)
    sed -n '2,40p' "$0"; exit 0 ;;
  *)
    DIE "unknown arg: $1 (try --help)" ;;
esac
