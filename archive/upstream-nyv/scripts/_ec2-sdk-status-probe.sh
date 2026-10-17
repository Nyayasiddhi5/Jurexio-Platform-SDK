#!/usr/bin/env bash
# SDK status probe — runs ON nysdev. Uses docker gateway keys if canon file empty.
# NV-SECRETS-001: never echo secret values.
set -uo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
API="https://api.nyayasiddhi.online"

read_key() {
  local var="$1"
  local val=""
  val=$(grep -E "^${var}=" "$CANON" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r\n"' || true)
  if [ "$(printf %s "$val" | wc -c | tr -d ' ')" -le 16 ]; then
    val=$(docker exec nyv-gateway printenv "$var" 2>/dev/null | tr -d '\r\n' || true)
  fi
  printf %s "$val"
}

NSPK=$(read_key NYV_SDK_KEY_NSP)
NYMK=$(read_key NYV_SDK_KEY_NYM)

echo "=== KEY LENS ==="
echo "canon_nsp_lines=$(grep -cE '^NYV_SDK_KEY_NSP=' "$CANON" 2>/dev/null || echo 0)"
echo "canon_nym_lines=$(grep -cE '^NYV_SDK_KEY_NYM=' "$CANON" 2>/dev/null || echo 0)"
echo "canon_file_bytes=$(wc -c < "$CANON" 2>/dev/null | tr -d ' ' || echo 0)"
echo "NSP_key_len=$(printf %s "$NSPK" | wc -c | tr -d ' ')"
echo "NYM_key_len=$(printf %s "$NYMK" | wc -c | tr -d ' ')"
echo "NSP_source=$([ "$(grep -cE '^NYV_SDK_KEY_NSP=' "$CANON" 2>/dev/null || echo 0)" -gt 0 ] && [ "$(grep -E '^NYV_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | wc -c | tr -d ' ')" -gt 16 ] && echo canon || echo docker_or_missing)"
echo "NYM_source=$([ "$(grep -cE '^NYV_SDK_KEY_NYM=' "$CANON" 2>/dev/null || echo 0)" -gt 0 ] && [ "$(grep -E '^NYV_SDK_KEY_NYM=' "$CANON" | head -1 | cut -d= -f2- | wc -c | tr -d ' ')" -gt 16 ] && echo canon || echo docker_or_missing)"

smoke() {
  local label="$1"; shift
  local timeout="${1:-60}"; shift
  local tmp
  tmp=$(mktemp)
  local code t size body
  code=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time "$timeout" "$@" 2>/dev/null || echo ERR)
  t=$(curl -sS -o /dev/null -w '%{time_total}' --max-time "$timeout" "$@" 2>/dev/null || echo 0)
  size=$(wc -c <"$tmp" | tr -d ' ')
  body=$(head -c 200 "$tmp" | tr '\n' ' ')
  local contract="unknown"
  if echo "$body" | grep -q '"success":true'; then contract=pass
  elif echo "$body" | grep -q '"status":"healthy"'; then contract=pass
  elif [ "$code" = "401" ] || [ "$code" = "403" ]; then contract=auth_fail
  elif [ "$code" = "502" ] || [ "$code" = "503" ]; then contract=upstream_fail
  elif [ "$code" = "200" ]; then contract=pass_no_envelope
  else contract=fail
  fi
  echo "ROUTE $label http=$code latency=${t}s size=$size contract=$contract"
  echo "  preview=${body:0:120}"
  rm -f "$tmp"
}

echo "=== NSP SDK ROUTES ==="
if [ "$(printf %s "$NSPK" | wc -c | tr -d ' ')" -gt 16 ]; then
  smoke health_nsp 15 -H "X-API-Key: $NSPK" -H "X-NYV-Platform: nsp" "$API/api/jrx/health"
  smoke models_nsp 30 -H "X-API-Key: $NSPK" -H "X-NYV-Platform: nsp" "$API/api/jrx/models"
  smoke dpdpa_nsp 30 -H "X-API-Key: $NSPK" -H "X-NYV-Platform: nsp" "$API/api/jrx/compliance/dpdpa/consent-records?limit=1"
  smoke orch_dashboard 30 -H "X-API-Key: $NSPK" -H "X-NYV-Platform: nsp" "$API/api/jrx/orchestration/dashboard"
  smoke caselaw_search 45 -H "X-API-Key: $NSPK" -H "X-NYV-Platform: nsp" "$API/api/jrx/knowledge/caselaw/search?q=bail&courtType=sc&limit=2"
  smoke instant_search 45 -H "X-API-Key: $NSPK" -H "X-NYV-Platform: nsp" -H "Content-Type: application/json" -X POST -d '{"query":"anticipatory bail","limit":3}' "$API/api/jrx/knowledge/instant-search"
  for pair in "legal-chat-fast|One line anticipatory bail BNSS" "legal-draft-fast|Draft one bail sentence"; do
    task="${pair%%|*}"
    prompt="${pair#*|}"
    tmp=$(mktemp)
    start_s=$(date +%s)
    code=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time 90 -X POST \
      -H "X-API-Key: $NSPK" -H "X-NYV-Platform: nsp" -H "Content-Type: application/json" \
      -d "{\"prompt\":\"$prompt\",\"taskType\":\"$task\",\"jurisdiction\":\"IN\",\"maxTokens\":128}" \
      "$API/api/jrx/orchestrate" 2>/dev/null || echo ERR)
    end_s=$(date +%s)
    ms=$(( (end_s - start_s) * 1000 ))
    python3 - "$task" "$code" "$ms" "$tmp" <<'PY'
import json, sys
task, code, ms, path = sys.argv[1:5]
try:
    d = json.load(open(path))
    data = d.get("data") or d
    route = data.get("routing") or {}
    path_val = route.get("path") if isinstance(route, dict) else route
    err = d.get("error") or {}
    ok = d.get("success")
    contract = "pass" if ok and code in ("200", "202") else ("auth_fail" if str(code) in ("401","403") else "fail")
    print(f"ROUTE orch_{task} http={code} latency={ms}ms contract={contract} success={ok} path={path_val} err={err.get('code')}")
except Exception as e:
    print(f"ROUTE orch_{task} http={code} latency={ms}ms contract=parse_err err={e}")
PY
    rm -f "$tmp"
  done
  for cnr in TSWL000000742024 RJHC010324382023; do
    tmp=$(mktemp)
    start_s=$(date +%s)
    code=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time 120 -X POST \
      -H "X-API-Key: $NSPK" -H "X-NYV-Platform: nsp" -H "Content-Type: application/json" \
      -d "{\"cnr\":\"$cnr\",\"claimEcourts\":false}" \
      "$API/api/jrx/v1/sdk/cnr/resolve" 2>/dev/null || echo ERR)
    end_s=$(date +%s)
    ms=$(( (end_s - start_s) * 1000 ))
    python3 - "$cnr" "$code" "$ms" "$tmp" <<'PY'
import json, sys
cnr, code, ms, path = sys.argv[1:5]
try:
    d = json.load(open(path))
    data = d.get("data") or d
    tier = data.get("tier") or data.get("source") or data.get("resolutionTier")
    status = data.get("status") or data.get("analysisStatus") or data.get("matchStatus")
    ok = d.get("success")
    contract = "pass" if ok and str(code) == "200" else ("degraded" if ok else "fail")
    print(f"ROUTE cnr_{cnr} http={code} latency={ms}ms contract={contract} status={status} tier={tier} success={ok}")
except Exception as e:
    print(f"ROUTE cnr_{cnr} http={code} latency={ms}ms contract=parse_err err={e}")
PY
    rm -f "$tmp"
  done
else
  echo "NSP_SKIP=no_key_available"
fi

echo "=== NYM SDK ROUTES ==="
if [ "$(printf %s "$NYMK" | wc -c | tr -d ' ')" -gt 16 ]; then
  smoke nym_health 15 -H "X-API-Key: $NYMK" -H "X-NYV-Platform: nym" "$API/api/jrx/health"
else
  echo "NYM_SKIP=no_key_available"
fi

echo "=== PROBE COMPLETE ==="
