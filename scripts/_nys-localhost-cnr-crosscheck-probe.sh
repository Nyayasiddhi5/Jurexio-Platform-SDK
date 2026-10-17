#!/usr/bin/env bash
# Legacy :8080 CNR/diary crosscheck on caselaw-worker. NV-SECRETS-001.
set -uo pipefail
cd /opt/nyv/api || exit 1

KEY=$(node -e "
const fs=require('fs');
for (const line of fs.readFileSync('.env','utf8').split(/\n/)) {
  if (line.startsWith('NYS_SDK_API_KEYS=')) {
    const v=line.split('=').slice(1).join('=').trim().replace(/^[\"']|[\"']$/g,'');
    console.log(v.split(',')[0].trim()); break;
  }
}")

probe() {
  local label="$1" body="$2"
  local tmp; tmp=$(mktemp)
  local start end ms code
  start=$(python3 -c 'import time;print(int(time.time()*1000))')
  code=$(curl -sS -o "$tmp" -w '%{http_code}' -m 120 -X POST \
    -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
    -d "$body" "http://127.0.0.1:8080/api/cnr/resolve" 2>/dev/null || echo ERR)
  end=$(python3 -c 'import time;print(int(time.time()*1000))')
  ms=$((end - start))
  python3 - "$label" "$code" "$ms" "$tmp" <<'PY'
import json, sys
label, code, ms, path = sys.argv[1:5]
try:
    d = json.load(open(path))
    data = d.get('data') or {}
    meta = data.get('meta') or {}
    src = data.get('source') or meta.get('source') or meta.get('tier') or '-'
    status = data.get('status') or '-'
    print(f"ROW|{label}|legacy_8080|{status}|{status}|{src}|{ms}ms|http={code}")
except Exception as e:
    print(f"ROW|{label}|legacy_8080|ERR|ERR|parse_err|{ms}ms|http={code}|{e}")
PY
  rm -f "$tmp"
}

echo "=== NYS LOCALHOST :8080 CROSSCHECK $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="

for spec in \
  "CNR_TSWL|{\"cnr\":\"TSWL000000742024\",\"options\":{\"includeDocuments\":false}}" \
  "CNR_RJHC|{\"cnr\":\"RJHC010324382023\",\"options\":{\"profile\":\"caseCreate\",\"includeDocuments\":false}}" \
  "CNR_GJHC|{\"cnr\":\"GJHC240256342024\",\"options\":{\"includeDocuments\":false}}" \
  "CNR_ZZZZ|{\"cnr\":\"ZZZZ000000000000\",\"options\":{\"includeDocuments\":false}}" \
  "DIARY_17329|{\"diaryNumber\":\"17329/2025\",\"options\":{\"courtType\":\"sc\",\"profile\":\"caseCreate\",\"includeDocuments\":false}}" \
  "DIARY_264|{\"diaryNumber\":\"264/2024\",\"options\":{\"courtType\":\"sc\",\"includeDocuments\":false}}" \
  "DIARY_INSC|{\"diaryNumber\":\"2023 INSC 1081\",\"options\":{\"courtType\":\"sc\",\"includeDocuments\":false}}"; do
  probe "${spec%%|*}" "${spec#*|}"
done

echo "=== DONE ==="
