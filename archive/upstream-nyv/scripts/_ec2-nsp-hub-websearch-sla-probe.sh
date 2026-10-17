#!/usr/bin/env bash
# Hub web-search SLA probe — NV-SECRETS-001
set -uo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
API="https://api.nyayasiddhi.online"
read_canon_key() {
  grep -E "^${1}=" "$CANON" 2>/dev/null | head -1 | cut -d= -f2- \
    | sed -E 's/^[[:space:]"'\'' ]+//; s/[[:space:]"'\'' ]+$//; s/\r$//'
}
NSPK="$(read_canon_key NYV_SDK_KEY_NSP)"
BODY='{"prompt":"Market intelligence: latest Indian fintech regulatory news and RBI circulars summary","taskType":"web-search","agentKey":"legal-researcher","jurisdiction":"IN","maxTokens":512}'

probe() {
  local T="$1"
  tmp=$(mktemp)
  start=$(date +%s)
  code=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time "$T" -X POST \
    -H "X-API-Key: $NSPK" -H "X-NYV-Platform: nsp" -H "Content-Type: application/json" \
    -d "$BODY" "$API/api/jrx/orchestrate" 2>/dev/null || echo ERR)
  end=$(date +%s)
  python3 - "$T" "$code" "$((end-start))" "$tmp" <<'PY'
import json, sys
T, code, sec, path = sys.argv[1:5]
try:
    d = json.load(open(path))
    data = d.get("data") or d
    err = d.get("error") or {}
    route = data.get("routing") or {}
    path_val = route.get("path") if isinstance(route, dict) else route
    ws = data.get("webSearch") or d.get("webSearch")
    print(
        f"timeout={T}s wall={sec}s http={code} success={d.get('success')} "
        f"path={path_val} content_len={len(str(data.get('content') or ''))} "
        f"webSearch={ws} err={err.get('code') or str(err.get('message',''))[:80]}"
    )
except Exception as e:
    print(f"timeout={T}s wall={sec}s http={code} parse_err={e} head={open(path).read()[:120]}")
PY
  rm -f "$tmp"
}

echo "=== Hub-style web-search + legal-researcher ==="
probe 120
probe 180

BODY2='{"prompt":"Research precedents on anticipatory bail under BNSS","taskType":"legal_research","agentKey":"legal-researcher","jurisdiction":"IN","maxTokens":512}'
echo "=== legal_research (counsel — expect slow) max 90s ==="
tmp=$(mktemp)
code=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time 90 -X POST \
  -H "X-API-Key: $NSPK" -H "X-NYV-Platform: nsp" -H "Content-Type: application/json" \
  -d "$BODY2" "$API/api/jrx/orchestrate" 2>/dev/null || echo ERR)
echo "legal_research http=$code size=$(wc -c <"$tmp" | tr -d ' ')"
rm -f "$tmp"
