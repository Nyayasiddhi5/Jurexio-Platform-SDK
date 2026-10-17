#!/usr/bin/env bash
# NV-HC-MIRROR-P1-001 — run mirror job on caselaw-worker (fetch) + optional map insert via GATEWAY_DATABASE_URL.
set -euo pipefail
APPLY="${NV_HC_MIRROR_APPLY:-0}"
CNR="${1:-APHC010000832023}"
cd /opt/nyv/api || exit 1

KEY=""
pid=$(pgrep -f 'uvicorn.*8090' | head -1 || true)
[ -n "$pid" ] && [ -r "/proc/$pid/environ" ] && KEY=$(tr '\0' '\n' < "/proc/$pid/environ" | grep '^CASE_API_API_KEYS=' | head -1 | cut -d= -f2- | cut -d, -f1)

export NYSAPI_URL="${NYSAPI_URL:-http://127.0.0.1:8090}"
export NYSAPI_API_KEY="$KEY"
export NV_HC_ORDER_AUTH_BASE="${NV_HC_ORDER_AUTH_BASE:-http://127.0.0.1:8090}"
export NV_HC_ORDER_AUTH_API_KEY="${NV_HC_ORDER_AUTH_API_KEY:-$KEY}"
export NV_HC_MIRROR_BUCKET="${NV_HC_MIRROR_BUCKET:-ns-indian-highcourt-judgements-2}"

SCRIPT="/tmp/jrx-hc-order-mirror-p1.mjs"
if [ ! -f "$SCRIPT" ]; then
  if [ -f /opt/Nyayavigya/repo/current/scripts/jrx-hc-order-mirror-p1.mjs ]; then
    cp /opt/Nyayavigya/repo/current/scripts/jrx-hc-order-mirror-p1.mjs "$SCRIPT"
  elif compgen -G "/opt/Nyayavigya/repo/*/scripts/jrx-hc-order-mirror-p1.mjs" >/dev/null; then
    cp "$(ls -t /opt/Nyayavigya/repo/*/scripts/jrx-hc-order-mirror-p1.mjs | head -1)" "$SCRIPT"
  else
    echo "mirror_script_missing_on_host"
    exit 5
  fi
fi

ARGS=(--cnr "$CNR")
[ "$APPLY" = "1" ] && ARGS+=(--apply)

echo "=== NV-HC-ORDER-MIRROR-P1-RUN apply=$APPLY cnr=$CNR key_len=$(printf %s "$KEY" | wc -c | tr -d ' ') ==="
node "$SCRIPT" "${ARGS[@]}"
echo "=== DONE ==="
