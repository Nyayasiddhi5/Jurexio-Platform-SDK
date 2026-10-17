#!/usr/bin/env bash
# Inline partner smoke for EC2 (no dependency on nv-partner-smoke.sh path).
set -euo pipefail
BASE="https://api.nyayasiddhi.online"
CANON="/opt/Nyayavigya/secrets/.env.production"
PASS=0
FAIL=0
SKIPPED=0

key_for() {
  local sku="$1"
  grep -E "^NYV_SDK_KEY_${sku}=" "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n'
}

http_get() {
  local url="$1" key="$2"
  if [ -n "$key" ]; then
    curl -sS -o /tmp/ps-body.json -w '%{http_code}' -m 90 -H "X-API-Key: ${key}" "$url"
  else
    curl -sS -o /tmp/ps-body.json -w '%{http_code}' -m 90 "$url"
  fi
}

http_post() {
  local url="$1" key="$2" body="$3"
  curl -sS -o /tmp/ps-body.json -w '%{http_code}' -m 90 \
    -X POST -H "X-API-Key: ${key}" -H 'Content-Type: application/json' -d "$body" "$url"
}

check() {
  local name="$1" code="$2" expect="$3"
  if [ "$code" = "$expect" ]; then PASS=$((PASS+1)); echo "PASS $name ($code)"; else FAIL=$((FAIL+1)); echo "FAIL $name ($code expected $expect)"; fi
}

code=$(http_get "${BASE}/api/jrx/health" "")
check public-health "$code" 200

RESEARCH='{"query":"What is consideration under the Indian Contract Act?","jurisdiction":"IN"}'
ORCH='{"prompt":"In one sentence, what is breach of contract?","agentId":"summarizer","jurisdiction":"IN","taskType":"summarize","mode":"sync"}'

for sku in NSP NSPM NSI NSA NSM NYM JRX; do
  key=$(key_for "$sku")
  if [ -z "$key" ]; then SKIPPED=$((SKIPPED+1)); echo "SKIP $sku no key"; continue; fi
  code=$(http_get "${BASE}/api/jrx/gateway/health" "$key"); check "${sku}-health" "$code" 200
  code=$(http_get "${BASE}/api/jrx/v1/sdk/llm/catalog" "$key"); check "${sku}-catalog" "$code" 200
  code=$(http_get "${BASE}/api/jrx/gateway/agents" "$key"); check "${sku}-agents" "$code" 200
  code=$(http_post "${BASE}/api/jrx/gateway/research/query" "$key" "$RESEARCH"); check "${sku}-research" "$code" 200
  code=$(http_post "${BASE}/api/jrx/orchestrate" "$key" "$ORCH"); check "${sku}-orch" "$code" 200
done

TOTAL=$((PASS+FAIL))
echo "SUMMARY pass=$PASS fail=$FAIL skip=$SKIPPED total=$((PASS+FAIL+SKIPPED))"
[ "$FAIL" -eq 0 ]
