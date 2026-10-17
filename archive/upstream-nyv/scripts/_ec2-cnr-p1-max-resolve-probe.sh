#!/usr/bin/env bash
# NV-CNR-P1-MAX-RESOLVE-001 — post-deploy P1 max-detail resolve probe.
# Runs ON nysdev EC2. NV-SECRETS-001: counts/lengths only, no secret values.
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
    prov = meta.get("provenance") or {}
    fields = data.get("fields") or {}
    hearings = (fields.get("hearings") or {}).get("value") or []
    tl = (data.get("caseCreate") or {}).get("timeline") or []
    petitioners = data.get("petitioners") or fields.get("petitioners") or []
    respondents = data.get("respondents") or fields.get("respondents") or []
    citation = data.get("citation") or (fields.get("citation") or {}).get("value")
    table_version = prov.get("tableVersion")
    print(
        f"PROBE {label} http={code} ms={ms} success={d.get('success')} "
        f"status={data.get('status')} source={data.get('source') or meta.get('tier')} "
        f"petitioners={len(petitioners) if isinstance(petitioners, list) else 0} "
        f"respondents={len(respondents) if isinstance(respondents, list) else 0} "
        f"citation={'yes' if citation else 'no'} "
        f"tableVersion={table_version!r} "
        f"hearings={len(hearings) if isinstance(hearings, list) else 0} "
        f"timeline={len(tl)} cnr={data.get('cnr')!r}"
    )
except Exception as e:
    print(f"PROBE {label} http={code} ms={ms} parse_err={e} body_head={open(path).read()[:120]}")
PY
  rm -f "$tmp"
}

echo "=== CNR P1 MAX-RESOLVE PROBE $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
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
health_body=$(curl -sS --max-time 15 "$API/api/jrx/health" 2>/dev/null || echo '{}')
echo "health_http=$health_code"
python3 - "$health_body" <<'PY'
import json, sys
try:
    d = json.loads(sys.argv[1])
    print(f"health_sha={d.get('gitSha') or d.get('sha') or d.get('commit')!r}")
except Exception:
    print("health_sha=parse_err")
PY

if [ "$(printf %s "$NSPK" | wc -c)" -le 16 ]; then echo "SKIP no NSP key"; exit 1; fi

# P1-A: HC CNR with caseCreate + includeTimeline — petitioners[], citation, tableVersion
probe_json "P1A_HC_MAX" \
  '{"identifier":"RJHC010324382023","options":{"profile":"caseCreate","includeTimeline":true}}'

# P1-B: regression — unified identifier SC/HC/DC still 200
probe_json "P1B_SC_DIARY" \
  '{"identifier":"173292025","options":{"profile":"caseCreate"}}'

probe_json "P1B_HC_CNR" \
  '{"identifier":"RJHC010324382023","options":{"profile":"caseCreate"}}'

probe_json "P1B_DC_CNR" \
  '{"identifier":"DLCT010001232023","options":{"profile":"caseCreate","courtType":"dc"}}'

echo "=== P1 PROBE DONE ==="
