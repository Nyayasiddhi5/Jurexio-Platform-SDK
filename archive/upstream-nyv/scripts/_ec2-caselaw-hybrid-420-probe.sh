#!/usr/bin/env bash
# Caselaw hybrid fallback probe — Section 420 IPC on nysdev. Keys from canonical env only.
set -uo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
NSPK="$(grep -E '^NYV_SDK_KEY_NSP=' "$CANON" 2>/dev/null | head -1 | cut -d= -f2- | sed -E 's/^[[:space:]"'\'' ]+//; s/[[:space:]"'\'' ]+$//')"
API="https://api.nyayasiddhi.online"
Q="Section+420+IPC"

echo "CURRENT=$(cat /opt/nyayavigya/CURRENT_DEPLOY 2>/dev/null || echo missing)"

for mode in hybrid fts default; do
  tmp=$(mktemp)
  code=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time 90 \
    -H "X-API-Key: $NSPK" -H "X-NYV-Platform: nsp" \
    "$API/api/jrx/knowledge/caselaw/search?q=$Q&limit=5&mode=$mode" 2>/dev/null || echo ERR)
  python3 - "$mode" "$code" "$tmp" <<'PY'
import json, sys
mode, code, path = sys.argv[1:4]
try:
    d = json.load(open(path))
    data = d.get("data") or d
    total = data.get("total", "?")
    meta = data.get("metadata") or {}
    sm = meta.get("searchMode", "-")
    reason = meta.get("reason", "-")
    print(f"CASELAW mode={mode} http={code} total={total} searchMode={sm} reason={reason}")
except Exception as e:
    print(f"CASELAW mode={mode} http={code} parse_err={e}")
PY
  rm -f "$tmp"
done
