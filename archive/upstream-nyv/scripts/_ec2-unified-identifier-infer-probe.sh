#!/usr/bin/env bash
# NV-CNR-COURT-TYPE-INFER-001 — post-deploy unified identifier + court-type inference probe (NV-SECRETS-001).
set -uo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
API="https://api.nyayasiddhi.online"
DEPLOY_DIR="/opt/nyayavigya/repo/CURRENT_DEPLOY"

read_canon_key() {
  grep -E "^${1}=" "$CANON" 2>/dev/null | head -1 | cut -d= -f2- \
    | sed -E 's/^[[:space:]"'\'' ]+//; s/[[:space:]"'\'' ]+$//; s/\r$//'
}

NSPK="$(read_canon_key NYV_SDK_KEY_NSP)"

probe_json() {
  local label="$1" body="$2"
  local tmp; tmp=$(mktemp)
  local start_ms end_ms ms code
  start_ms=$(date +%s%3N 2>/dev/null || python3 -c 'import time;print(int(time.time()*1000))')
  code=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time 120 -X POST \
    -H "X-API-Key: $NSPK" -H "X-NYV-Platform: nsp" -H "Content-Type: application/json" \
    -d "$body" "$API/api/jrx/v1/sdk/cnr/resolve" 2>/dev/null || echo ERR)
  end_ms=$(date +%s%3N 2>/dev/null || python3 -c 'import time;print(int(time.time()*1000))')
  ms=$((end_ms - start_ms))
  python3 - "$label" "$code" "$ms" "$tmp" <<'PY'
import json, sys
label, code, ms, path = sys.argv[1:5]
try:
    raw = open(path).read()
    d = json.loads(raw) if raw.strip() else {}
    data = d.get("data") or d
    meta = data.get("meta") or {}
    inferred = meta.get("inferredCourtType")
    kind = meta.get("identifierKind")
    status = data.get("status")
    source = data.get("source") or meta.get("tier")
    diary = data.get("diaryNumber")
    cnr = data.get("cnr")
    print(
        f"PROBE {label} http={code} ms={ms} success={d.get('success')} "
        f"status={status} inferredCourtType={inferred} identifierKind={kind} "
        f"source={source} diary={diary} cnr={cnr}"
    )
except Exception as e:
    print(f"PROBE {label} http={code} ms={ms} parse_err={e} body_head={open(path).read()[:120]}")
PY
  rm -f "$tmp"
}

echo "=== UNIFIED IDENTIFIER INFER PROBE $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo "NSP_key_len=$(printf %s "$NSPK" | wc -c | tr -d ' ')"

if [ -L "$DEPLOY_DIR" ] || [ -d "$DEPLOY_DIR" ]; then
  echo "CURRENT_DEPLOY=$(readlink -f "$DEPLOY_DIR" 2>/dev/null || echo "$DEPLOY_DIR")"
  if [ -f "$DEPLOY_DIR/.deploy-meta" ]; then
    cat "$DEPLOY_DIR/.deploy-meta" 2>/dev/null || true
  fi
fi

if [ -f /opt/nyayavigya/deploys.log ]; then
  echo "last_deploy_line=$(tail -1 /opt/nyayavigya/deploys.log)"
fi

health_code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$API/api/jrx/health" 2>/dev/null || echo ERR)
echo "health_http=$health_code"

if [ "$(printf %s "$NSPK" | wc -c)" -le 16 ]; then echo "SKIP no NSP key"; exit 1; fi

probe_json "SC_DIARY_IDENTIFIER" \
  '{"identifier":"173292025","options":{"profile":"caseCreate"}}'
probe_json "HC_CNR_IDENTIFIER" \
  '{"identifier":"RJHC010324382023"}'
probe_json "DC_CNR_IDENTIFIER" \
  '{"identifier":"DLCT010001232023"}'

echo "=== PROBE DONE ==="
