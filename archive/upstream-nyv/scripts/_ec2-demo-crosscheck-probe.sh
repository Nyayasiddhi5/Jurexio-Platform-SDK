#!/usr/bin/env bash
# Demo crosscheck probe — runs ON nysdev EC2. Reads keys from canonical env only.
# NV-SECRETS-001: never echo secret values. Key lens = length only.
set -uo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
API="https://api.nyayasiddhi.online"

read_canon_key() {
  grep -E "^${1}=" "$CANON" 2>/dev/null | head -1 | cut -d= -f2- \
    | sed -E 's/^[[:space:]"'\'' ]+//; s/[[:space:]"'\'' ]+$//; s/\r$//'
}

NSPK="$(read_canon_key NYV_SDK_KEY_NSP)"
NYMK="$(read_canon_key NYV_SDK_KEY_NYM)"

echo "=== DEPLOY ==="
echo "CURRENT=$(cat /opt/nyayavigya/CURRENT_DEPLOY 2>/dev/null || echo missing)"
echo "LAST_GOOD=$(cat /opt/nyayavigya/LAST_GOOD_DEPLOY 2>/dev/null || echo missing)"
LIVE=$(ls -dt /opt/Nyayavigya/repo/* 2>/dev/null | head -1 || true)
echo "LIVE=$LIVE"
if [ -n "$LIVE" ] && [ -d "$LIVE/.git" ]; then
  echo "GIT_SHA=$(git -C "$LIVE" rev-parse --short HEAD 2>/dev/null || echo unknown)"
fi
docker inspect nyv-gateway --format 'gateway={{.State.Status}} started={{.State.StartedAt}} restarts={{.RestartCount}}' 2>/dev/null || true
docker inspect nyv-console --format 'console={{.State.Status}} started={{.State.StartedAt}}' 2>/dev/null || true

echo "=== KEY LENS (canonical $CANON) ==="
echo "NSP_key_len=$(printf %s "$NSPK" | wc -c | tr -d ' ')"
echo "NYM_key_len=$(printf %s "$NYMK" | wc -c | tr -d ' ')"

smoke() {
  local label="$1"; shift
  local timeout="${1:-60}"; shift
  local tmp
  tmp=$(mktemp)
  local code t size
  code=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time "$timeout" "$@" 2>/dev/null || echo ERR)
  t=$(curl -sS -o /dev/null -w '%{time_total}' --max-time "$timeout" "$@" 2>/dev/null || echo 0)
  size=$(wc -c <"$tmp" | tr -d ' ')
  echo "SMOKE $label http=$code time=${t}s size=$size"
  head -c 150 "$tmp" | tr '\n' ' '
  echo
  rm -f "$tmp"
}

echo "=== SMOKE MATRIX (partner SDK routes) ==="
smoke health_public 15 "$API/api/jrx/health"
if [ "$(printf %s "$NSPK" | wc -c)" -gt 16 ]; then
  smoke health_nsp 15 -H "X-API-Key: $NSPK" -H "X-NYV-Platform: nsp" "$API/api/jrx/health"
  smoke gateway_models_nsp 30 -H "X-API-Key: $NSPK" -H "X-NYV-Platform: nsp" "$API/api/jrx/gateway/models"
  smoke caselaw_default_fts 15 -H "X-API-Key: $NSPK" -H "X-NYV-Platform: nsp" "$API/api/jrx/knowledge/caselaw/search?q=bail&courtType=sc&limit=2"
  smoke caselaw_hybrid 20 -H "X-API-Key: $NSPK" -H "X-NYV-Platform: nsp" "$API/api/jrx/knowledge/caselaw/search?q=bail&courtType=sc&limit=2&mode=hybrid"
  smoke caselaw_fts 15 -H "X-API-Key: $NSPK" -H "X-NYV-Platform: nsp" "$API/api/jrx/knowledge/caselaw/search?q=anticipatory+bail&mode=fts&limit=3"
  echo "CONSOLE_JWT_ONLY expect_401_with_api_key_only: /models /orchestration/dashboard /compliance/dpdpa"
else
  echo "NSP_SKIP=no_key_in_canon"
fi

echo "=== ORCH FAST ==="
if [ "$(printf %s "$NSPK" | wc -c)" -gt 16 ]; then
  for pair in "legal-chat-fast|One line anticipatory bail BNSS" "legal-draft-fast|Draft one bail sentence"; do
    task="${pair%%|*}"
    prompt="${pair#*|}"
    tmp=$(mktemp)
    start_ms=$(date +%s%3N 2>/dev/null || python3 -c 'import time; print(int(time.time()*1000))')
    code=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time 90 -X POST \
      -H "X-API-Key: $NSPK" -H "X-NYV-Platform: nsp" -H "Content-Type: application/json" \
      -d "{\"prompt\":\"$prompt\",\"taskType\":\"$task\",\"jurisdiction\":\"IN\",\"maxTokens\":128}" \
      "$API/api/jrx/orchestrate" 2>/dev/null || echo ERR)
    end_ms=$(date +%s%3N 2>/dev/null || python3 -c 'import time; print(int(time.time()*1000))')
    ms=$((end_ms - start_ms))
    python3 - "$task" "$code" "$ms" "$tmp" <<'PY'
import json, sys
task, code, ms, path = sys.argv[1:5]
try:
    d = json.load(open(path))
    data = d.get("data") or d
    route = data.get("routing") or {}
    path_val = route.get("path") if isinstance(route, dict) else route
    err = d.get("error") or {}
    print(f"ORCH {task} http={code} ms={ms} success={d.get('success')} path={path_val} content_len={len(str(data.get('content') or ''))} err={err.get('code')}")
except Exception as e:
    print(f"ORCH {task} http={code} ms={ms} parse_err={e}")
PY
    rm -f "$tmp"
  done
fi

echo "=== CNR PROBES (profile-aware: TSWL=default RDS, RJHC=caseCreate Athena) ==="
if [ "$(printf %s "$NSPK" | wc -c)" -gt 16 ]; then
  for cnr in TSWL000000742024 RJHC010324382023; do
    case "$cnr" in
      RJHC010324382023)
        cnr_profile=caseCreate
        cnr_body='{"cnr":"RJHC010324382023","claimEcourts":false,"options":{"profile":"caseCreate"}}'
        ;;
      *)
        cnr_profile=default
        cnr_body='{"cnr":"TSWL000000742024","claimEcourts":false}'
        ;;
    esac
    tmp=$(mktemp)
    start_ms=$(date +%s%3N 2>/dev/null || python3 -c 'import time; print(int(time.time()*1000))')
    code=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time 120 -X POST \
      -H "X-API-Key: $NSPK" -H "X-NYV-Platform: nsp" -H "Content-Type: application/json" \
      -d "$cnr_body" \
      "$API/api/jrx/v1/sdk/cnr/resolve" 2>/dev/null || echo ERR)
    end_ms=$(date +%s%3N 2>/dev/null || python3 -c 'import time; print(int(time.time()*1000))')
    ms=$((end_ms - start_ms))
    python3 - "$cnr" "$cnr_profile" "$code" "$ms" "$tmp" <<'PY'
import json, sys
cnr, profile, code, ms, path = sys.argv[1:6]
try:
    d = json.load(open(path))
    data = d.get("data") or d
    tier = data.get("tier") or data.get("source") or data.get("resolutionTier")
    status = data.get("status") or data.get("analysisStatus") or data.get("matchStatus")
    print(f"CNR {cnr} profile={profile} http={code} ms={ms} status={status} tier={tier} success={d.get('success')}")
except Exception as e:
    print(f"CNR {cnr} profile={profile} http={code} ms={ms} parse_err={e}")
PY
    rm -f "$tmp"
  done
fi

echo "=== NYM (partner SDK) ==="
if [ "$(printf %s "$NYMK" | wc -c)" -gt 16 ]; then
  smoke nym_health 15 -H "X-API-Key: $NYMK" -H "X-NYV-Platform: nym" "$API/api/jrx/health"
  tmp=$(mktemp)
  code=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time 90 -X POST \
    -H "X-API-Key: $NYMK" -H "X-NYV-Platform: nym" -H "Content-Type: application/json" \
    -d '{"prompt":"One line anticipatory bail","taskType":"legal-chat-fast","jurisdiction":"IN","maxTokens":128}' \
    "$API/api/jrx/orchestrate" 2>/dev/null || echo ERR)
  python3 - "$code" "$tmp" <<'PY'
import json, sys
code, path = sys.argv[1:3]
try:
    d = json.load(open(path))
    data = d.get("data") or d
    print(f"ORCH nym_legal-chat-fast http={code} success={d.get('success')} content_len={len(str(data.get('content') or ''))}")
except Exception as e:
    print(f"ORCH nym_legal-chat-fast http={code} parse_err={e}")
PY
  rm -f "$tmp"
else
  echo "NYM_SKIP=no_key_in_canon"
fi

echo "=== LOG GREP 4h gateway ==="
docker logs nyv-gateway --since 4h 2>&1 | grep -iE '"statusCode":(4[0-9]{2}|5[0-9]{2})|"level":"error"|ECONNREFUSED|ETIMEDOUT|QUALITY_ENVELOPE|Unhandled|fatal' | grep -v '"statusCode":200' | tail -40 || echo gateway_log_clean_or_empty

echo "=== LOG GREP 4h console ==="
docker logs nyv-console --since 4h 2>&1 | grep -iE 'error| 5[0-9]{2} | 4[0-9]{2} ' | tail -20 || echo console_log_clean

echo "=== PROBE COMPLETE ==="
