#!/usr/bin/env bash
set -euo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
API="https://api.nyayasiddhi.online"
FAIL=0
key_for() { grep -E "^NYV_SDK_KEY_${1}=" "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n'; }

echo "=== CNR /api/jrx/v1/sdk/cnr/resolve ==="
NSPK=$(key_for NSP)
code=$(curl -sS -o /tmp/cnr.json -w '%{http_code}' -m 40 -X POST -H "X-API-Key: ${NSPK}" -H 'Content-Type: application/json' \
  -d '{"cnr":"TSWL000000742024"}' "${API}/api/jrx/v1/sdk/cnr/resolve" || echo 000)
python3 - <<PY
import json
d=json.load(open("/tmp/cnr.json"))
inner=d.get("data") if isinstance(d.get("data"), dict) else d
claim=inner.get("claimEcourts")
print("CNR HTTP $code found=%s claimEcourts=%s court=%s src=%s" % (
    inner.get("found"), claim, inner.get("courtType"), inner.get("sourceArchive") or inner.get("source")))
if "$code" != "200":
    raise SystemExit(2)
if str(claim).lower() == "true":
    raise SystemExit(3)
PY
[ $? -eq 0 ] || FAIL=$((FAIL+1))

echo "=== remaining SKU gateway/health + orchestrate ==="
ORCH='{"prompt":"In one sentence, what is breach of contract?","agentId":"summarizer","jurisdiction":"IN","taskType":"summarize","mode":"sync"}'
for sku in NSPM NSI NSA NSM JRX; do
  key=$(key_for "$sku")
  if [ -z "$key" ]; then echo "SKIP $sku"; continue; fi
  h=$(curl -sS -o /tmp/ps-body.json -w '%{http_code}' -m 60 -H "X-API-Key: ${key}" "${API}/api/jrx/gateway/health" || echo 000)
  o=$(curl -sS -o /tmp/ps-body.json -w '%{http_code}' -m 120 -X POST -H "X-API-Key: ${key}" -H 'Content-Type: application/json' -d "$ORCH" "${API}/api/jrx/orchestrate" || echo 000)
  echo "$sku health=$h orch=$o"
  [ "$h" = "200" ] && [ "$o" = "200" ] || FAIL=$((FAIL+1))
done

echo "FAILS=$FAIL"
[ "$FAIL" -eq 0 ]
