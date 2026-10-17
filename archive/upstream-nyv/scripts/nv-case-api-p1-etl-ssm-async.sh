#!/usr/bin/env bash
# SSM-safe async P1 ETL kickoff — self-contained (writes /tmp/jrx-p1-etl/* then nohup).
set -euo pipefail
API="${NYS_API_DIR:-/opt/nyv/api}"
LOG_DIR="${NYS_OPS_LOG_DIR:-/var/log/nys-ops}"
PY="${CASE_API_PYTHON:-/home/ubuntu/scripts/case_api/.venv/bin/python3}"
LOOKUP="${CASE_API_LOOKUP_DIR:-/home/ubuntu/scripts/case_api/_build/case_lookup_full/current}"
WORK="/tmp/jrx-p1-etl"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG="$LOG_DIR/p1-etl-${STAMP}.log"
mkdir -p "$LOG_DIR" "$WORK"

NOW_YEAR="$(date -u +%Y)"
export CORPUS_END_YEAR="${CORPUS_END_YEAR:-$NOW_YEAR}"
export CORPUS_START_YEAR="${CORPUS_START_YEAR:-$((NOW_YEAR - 1))}"
export RDS_STATEMENT_TIMEOUT_MS="${RDS_STATEMENT_TIMEOUT_MS:-600000}"
export P1_ETL_BATCH_SIZE="${P1_ETL_BATCH_SIZE:-500}"

if pgrep -f "./jrx-case-api-p1-etl-reverse-2026.py" >/dev/null 2>&1; then
  echo "SKIPPED: P1 ETL already running pid=$(pgrep -f './jrx-case-api-p1-etl-reverse-2026.py' | head -1)"
  exit 0
fi

# Materialize ETL payload under /tmp (repo may not exist on worker)
if [[ -f /opt/nyv/api/scripts/jrx-case-api-p1-etl-reverse-2026.py ]]; then
  cp /opt/nyv/api/scripts/jrx-case-api-p1-etl-reverse-2026.py "$WORK/etl.py"
  cp /opt/nyv/api/scripts/sql/case-api-p1-staging-ddl.sql "$WORK/staging-ddl.sql" 2>/dev/null || true
  cp /opt/nyv/api/scripts/sql/case-api-p1-cases-view-ddl.sql "$WORK/view-ddl.sql" 2>/dev/null || true
fi

# Fallback: expect caller to have written files via prior deploy; else inline minimal DDL
if [[ ! -f "$WORK/staging-ddl.sql" ]]; then
  cat >"$WORK/staging-ddl.sql" <<'SQL'
BEGIN;
ALTER TABLE cases_search_staging
  ADD COLUMN IF NOT EXISTS diary_no text,
  ADD COLUMN IF NOT EXISTS petitioner_address text,
  ADD COLUMN IF NOT EXISTS respondent_address text,
  ADD COLUMN IF NOT EXISTS petitioner_phone text,
  ADD COLUMN IF NOT EXISTS respondent_phone text,
  ADD COLUMN IF NOT EXISTS petitioner_email text,
  ADD COLUMN IF NOT EXISTS respondent_email text,
  ADD COLUMN IF NOT EXISTS petitioner_father_name text,
  ADD COLUMN IF NOT EXISTS respondent_father_name text;
CREATE INDEX IF NOT EXISTS idx_css_diary_no ON cases_search_staging (diary_no)
  WHERE diary_no IS NOT NULL AND btrim(diary_no) <> '';
COMMIT;
SQL
fi

if [[ ! -f "$WORK/etl.py" ]]; then
  echo "BLOCKED: etl.py not found in $WORK or /opt/nyv/api/scripts — deploy scripts first"
  exit 2
fi

nohup env \
  CASE_API_LOOKUP_DIR="$LOOKUP" \
  CASE_API_PYTHON="$PY" \
  CORPUS_END_YEAR="$CORPUS_END_YEAR" \
  CORPUS_START_YEAR="$CORPUS_START_YEAR" \
  RDS_STATEMENT_TIMEOUT_MS="$RDS_STATEMENT_TIMEOUT_MS" \
  P1_ETL_BATCH_SIZE="$P1_ETL_BATCH_SIZE" \
  P1_DDL_PATH="$WORK/staging-ddl.sql" \
  P1_VIEW_DDL_PATH="${WORK}/view-ddl.sql" \
  "$PY" "$WORK/etl.py" >>"$LOG" 2>&1 &

echo "P1_ETL_STARTED pid=$! log=$LOG years=${CORPUS_END_YEAR}..${CORPUS_START_YEAR} work=$WORK"
sleep 3
pgrep -af "./jrx-case-api-p1-etl-reverse-2026.py" || pgrep -af "$WORK/etl.py" || echo "etl: not yet visible"
