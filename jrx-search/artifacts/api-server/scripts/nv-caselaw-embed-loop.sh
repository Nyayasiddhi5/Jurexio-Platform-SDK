#!/bin/bash
# nv-caselaw-embed-loop — HC-priority NULL-embedding backfill (shard-aware)
# Deploy to /opt/nyv/api/nv-caselaw-embed-loop.sh on the caselaw worker.
#
# One process per (EMBED_SCOPE, EMBED_SHARD). Run 3 HC shards + 1 DC:
#   EMBED_SCOPE=hc EMBED_SHARDS=3 EMBED_SHARD=0|1|2
#   EMBED_SCOPE=dc EMBED_SHARDS=1 EMBED_SHARD=0
#
# Env knobs (systemd Environment= / EnvironmentFile=):
#   EMBED_CONCURRENCY   default 10  — per-process Bedrock invokes
#   EMBED_BATCH         default 200
#   EMBED_HC_MAX_ROWS   default 200000
#   EMBED_SCOPE         default hc
#   EMBED_SHARDS        default 1
#   EMBED_SHARD         default 0
#   EMBED_ALL_MAX_ROWS  default 0
#   EMBED_SKIP_SC       default 1
# Model: BEDROCK_EMBED_MODEL=amazon.titan-embed-text-v2:0

set -u

export EMBED_CONCURRENCY="${EMBED_CONCURRENCY:-10}"
export EMBED_TRUNCATE_CHARS="${EMBED_TRUNCATE_CHARS:-8000}"
export EMBED_SHARDS="${EMBED_SHARDS:-1}"
export EMBED_SHARD="${EMBED_SHARD:-0}"

EMBED_BATCH="${EMBED_BATCH:-200}"
EMBED_HC_MAX_ROWS="${EMBED_HC_MAX_ROWS:-200000}"
EMBED_HC_BATCH="${EMBED_HC_BATCH:-$EMBED_BATCH}"
EMBED_ALL_MAX_ROWS="${EMBED_ALL_MAX_ROWS:-0}"
EMBED_ALL_BATCH="${EMBED_ALL_BATCH:-150}"
EMBED_SKIP_SC="${EMBED_SKIP_SC:-1}"
EMBED_SC_MAX_ROWS="${EMBED_SC_MAX_ROWS:-5000}"
EMBED_SC_BATCH="${EMBED_SC_BATCH:-100}"
EMBED_SCOPE="${EMBED_SCOPE:-hc}"
EMBED_DC_MAX_ROWS="${EMBED_DC_MAX_ROWS:-80000}"
EMBED_DC_BATCH="${EMBED_DC_BATCH:-$EMBED_BATCH}"

API_DIR="${API_DIR:-/opt/nyv/api}"
ENV_FILE="${ENV_FILE:-/opt/nyv/api/.env}"
LOOP_LOG="${LOOP_LOG:-/opt/nyv/embed-loop.log}"
EMBED_LOG="${EMBED_LOG:-/opt/nyv/embed.log}"
LOCK_DIR="${LOCK_DIR:-/var/lock}"
LOCK_FILE="${LOCK_DIR}/nyv-embed-${EMBED_SCOPE}-s${EMBED_SHARD}.lock"

mkdir -p "${LOCK_DIR}" 2>/dev/null || true
exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] shard ${EMBED_SCOPE}:${EMBED_SHARD} already locked — exit" >> "${LOOP_LOG}"
  exit 0
fi

run_embed() {
  local max_rows="$1" batch="$2" scope="$3"
  # NYS-EMBED-NEWEST-FIRST-001 — an optional 4th arg overrides EMBED_YEAR_MIN for THIS pass,
  # so one loop can run a newest-first window and a general catch-up pass in turn.
  local year_min="${4:-${EMBED_YEAR_MIN:-}}"
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] embed-corpus ${scope} shard=${EMBED_SHARD}/${EMBED_SHARDS} maxRows=${max_rows} batch=${batch} concurrency=${EMBED_CONCURRENCY} yearMin=${year_min:-none}" >> "${LOOP_LOG}"
  # EMBED_YEAR_MIN must be forwarded explicitly: `env` here replaces the child environment,
  # so a variable set only in the unit file would silently NOT reach embed-corpus.mjs.
  NODE_ENV=production nice -n 10 env EMBED_SHARD="${EMBED_SHARD}" EMBED_SHARDS="${EMBED_SHARDS}" \
    EMBED_YEAR_MIN="${year_min}" \
    node --env-file="${ENV_FILE}" "${API_DIR}/embed-corpus.mjs" \
    "${max_rows}" "${batch}" "${scope}" >> "${EMBED_LOG}" 2>&1 || true
}

while true; do
  cd "${API_DIR}" || exit 1

  case "${EMBED_SCOPE}" in
    dc)
      run_embed "${EMBED_DC_MAX_ROWS}" "${EMBED_DC_BATCH}" dc
      ;;
    sc)
      if [ "${EMBED_SKIP_SC}" != "1" ]; then
        run_embed "${EMBED_SC_MAX_ROWS}" "${EMBED_SC_BATCH}" sc
      fi
      ;;
    all)
      if [ "${EMBED_ALL_MAX_ROWS}" -gt 0 ] 2>/dev/null; then
        run_embed "${EMBED_ALL_MAX_ROWS}" "${EMBED_ALL_BATCH}" all
      fi
      ;;
    *)
      run_embed "${EMBED_HC_MAX_ROWS}" "${EMBED_HC_BATCH}" hc
      ;;
  esac

  sleep 30
done
