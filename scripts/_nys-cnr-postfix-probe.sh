#!/usr/bin/env bash
# Direct NYS CNR probe on caselaw-worker after bundle patch.
set -uo pipefail
cd /opt/nyv/api || exit 1
KEY=$(node -e "
const fs=require('fs');
for (const line of fs.readFileSync('.env','utf8').split(/\n/)) {
  if (line.startsWith('NYS_SDK_API_KEYS=')) {
    const v=line.split('=').slice(1).join('=').trim().replace(/^[\"']|[\"']$/g,'');
    console.log(v.split(',')[0].trim());
    break;
  }
}")
echo "KEY_len=$(printf %s "$KEY" | wc -c | tr -d ' ')"
for cnr in TSWL000000742024 RJHC010324382023; do
  tmp=$(mktemp)
  start=$(date +%s%3N 2>/dev/null || python3 -c 'import time;print(int(time.time()*1000))')
  code=$(curl -sS -o "$tmp" -w '%{http_code}' -m 30 -X POST \
    -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
    -d "{\"cnr\":\"$cnr\",\"options\":{\"includeDocuments\":false}}" \
    "http://127.0.0.1:8080/api/cnr/resolve" 2>/dev/null || echo ERR)
  end=$(date +%s%3N 2>/dev/null || python3 -c 'import time;print(int(time.time()*1000))')
  ms=$((end - start))
  python3 - "$cnr" "$code" "$ms" "$tmp" <<'PY'
import json,sys
cnr,code,ms,path=sys.argv[1:5]
try:
 d=json.load(open(path))
 data=d.get('data') or {}
 print(f"NYS {cnr} http={code} ms={ms} status={data.get('status')} source={data.get('source')} latencyMs={data.get('meta',{}).get('latencyMs')}")
except Exception as e:
 print(f"NYS {cnr} http={code} ms={ms} err={e} body={open(path).read()[:100]}")
PY
  rm -f "$tmp"
done
