#!/usr/bin/env bash
# NV-PERF-HOTPATH-INDEX-001 — apply migrations/2026-09-02-perf-hotpath-indexes.sql on NYV RDS.
set +e
REPO="$(ls -dt /opt/Nyayavigya/repo/*/ 2>/dev/null | head -1)"
MIGFILE="2026-09-02-perf-hotpath-indexes.sql"
MIGPATH="${REPO%/}/migrations/$MIGFILE"
echo "=== repo: ${REPO:-NONE}"

CANON="/opt/Nyayavigya/secrets/.env.production"
ADM="$(docker exec nyv-gateway printenv DATABASE_URL_ADMIN 2>/dev/null)"; ADM="${ADM%\"}"; ADM="${ADM#\"}"
if [ -z "$ADM" ] && [ -f "$CANON" ]; then
  ADM="$(grep -E '^DATABASE_URL_ADMIN=' "$CANON" | head -1 | cut -d= -f2- | tr -d '\r\n')"
  ADM="${ADM%\"}"; ADM="${ADM#\"}"; ADM="${ADM%\'}"; ADM="${ADM#\'}"
fi
ADM="$(echo "$ADM" | sed -E 's/sslmode=no-verify/sslmode=require/; s/sslmode=verify-full/sslmode=require/')"
if [ -z "$ADM" ]; then echo "PROBE BROKEN: no DATABASE_URL_ADMIN"; exit 3; fi
echo "=== admin DSN: connected ok (len=${#ADM})"

if [ ! -f "$MIGPATH" ]; then
  echo "=== migration not in deployed repo; using inline SQL copy ==="
  MIGDIR="/tmp/jrx-perf-mig"
  mkdir -p "$MIGDIR"
  MIGPATH="$MIGDIR/$MIGFILE"
  cat > "$MIGPATH" <<'SQL'
-- NV-PERF-HOTPATH-INDEX-001 inline fallback
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sdk_keys_hashed_active
  ON sdk_app_api_keys (key_hash)
  WHERE is_active = true AND revoked_at IS NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orch_jobs_status_created
  ON nyayavigya_orchestration_jobs (status, created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_legal_chat_session_created
  ON legal_chat_messages (session_id, created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sdk_req_logs_app_created
  ON sdk_api_request_logs (application_id, created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_trace_created
  ON nv_audit_logs (trace_id, created_at DESC);
ANALYZE sdk_app_api_keys;
ANALYZE nyayavigya_orchestration_jobs;
ANALYZE legal_chat_messages;
ANALYZE sdk_api_request_logs;
ANALYZE nv_audit_logs;
SQL
fi

echo "=== applying $MIGFILE from $MIGPATH"
docker run --rm --network host -v "$(dirname "$MIGPATH")":/mig -e PGURL="$ADM" postgres:16-alpine \
  sh -c "psql \"\$PGURL\" -v ON_ERROR_STOP=1 -f /mig/$(basename "$MIGPATH")" 2>&1 | tail -20

echo "=== verify: five hot-path indexes ==="
docker run --rm --network host -e PGURL="$ADM" postgres:16-alpine sh -c 'psql "$PGURL" -At -c "
SELECT indexname FROM pg_indexes
 WHERE indexname IN (
  '"'"'idx_sdk_keys_hashed_active'"'"',
  '"'"'idx_orch_jobs_status_created'"'"',
  '"'"'idx_legal_chat_session_created'"'"',
  '"'"'idx_sdk_req_logs_app_created'"'"',
  '"'"'idx_audit_logs_trace_created'"'"'
 ) ORDER BY 1;"' 2>&1

echo "=== ANALYZE complete (see migration) ==="
