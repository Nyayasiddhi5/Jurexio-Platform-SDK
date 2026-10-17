#!/usr/bin/env bash
# NV-CASE-API-P1-001 — party PII / diary_no / acts hydration on case_api_search RDS.
# Reverse-year loop 2026 → 2025 from DuckDB case_lookup_full/current.
#
# Usage (caselaw-worker):
#   nohup bash scripts/jrx-case-api-p1-etl-reverse-2026.sh \
#     >> /var/log/nys-ops/p1-etl-$(date -u +%Y%m%dT%H%M%SZ).log 2>&1 &
#
# From workstation:
#   bash scripts/_nys-ssm-run.sh scripts/jrx-case-api-p1-etl-ssm-async.sh "p1-etl-kickoff"
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API="${NYS_API_DIR:-/opt/nyv/api}"
LOG_DIR="${NYS_OPS_LOG_DIR:-/var/log/nys-ops}"
PY="${CASE_API_PYTHON:-/home/ubuntu/scripts/case_api/.venv/bin/python3}"
LOOKUP="${CASE_API_LOOKUP_DIR:-/home/ubuntu/scripts/case_api/_build/case_lookup_full/current}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$LOG_DIR"

export CORPUS_END_YEAR="${CORPUS_END_YEAR:-2026}"
export CORPUS_START_YEAR="${CORPUS_START_YEAR:-2025}"
export RDS_STATEMENT_TIMEOUT_MS="${RDS_STATEMENT_TIMEOUT_MS:-600000}"
export P1_ETL_BATCH_SIZE="${P1_ETL_BATCH_SIZE:-500}"
export CASE_API_LOOKUP_DIR="$LOOKUP"
export P1_DDL_PATH="${P1_DDL_PATH:-$ROOT/scripts/sql/case-api-p1-staging-ddl.sql}"
export P1_VIEW_DDL_PATH="${P1_VIEW_DDL_PATH:-$ROOT/scripts/sql/case-api-p1-cases-view-ddl.sql}"

ETL_PY="${P1_ETL_PY:-$ROOT/scripts/jrx-case-api-p1-etl-reverse-2026.py}"

echo "=== NV-CASE-API-P1-ETL start $STAMP host=$(hostname) ==="
echo "years=${CORPUS_END_YEAR}..${CORPUS_START_YEAR} lookup=$LOOKUP batch=$P1_ETL_BATCH_SIZE timeout_ms=$RDS_STATEMENT_TIMEOUT_MS"

if pgrep -f "./jrx-case-api-p1-etl-reverse-2026.py" >/dev/null 2>&1; then
  echo "SKIPPED: P1 ETL already running pid=$(pgrep -f './jrx-case-api-p1-etl-reverse-2026.py' | head -1)"
  exit 0
fi

if [[ ! -x "$PY" ]]; then
  echo "BLOCKED: case_api python missing at $PY"
  exit 2
fi
if [[ ! -f "$ETL_PY" ]]; then
  echo "BLOCKED: ETL python missing at $ETL_PY"
  exit 2
fi
if [[ ! -d "$LOOKUP" ]]; then
  echo "BLOCKED: DuckDB lookup missing at $LOOKUP"
  exit 2
fi

exec "$PY" "$ETL_PY"
