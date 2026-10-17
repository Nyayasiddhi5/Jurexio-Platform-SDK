#!/usr/bin/env bash
# CNR 503 diagnostic — runs ON nysdev EC2. NV-SECRETS-001: lengths/codes only.
set -uo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
read_canon_key() {
  grep -E "^${1}=" "$CANON" 2>/dev/null | head -1 | cut -d= -f2- \
    | sed -E 's/^[[:space:]"'\'' ]+//; s/[[:space:]"'\'' ]+$//; s/\r$//'
}
NSPK="$(read_canon_key NYV_SDK_KEY_NSP)"
NYS_URL="$(read_canon_key NYS_KNOWLEDGE_BASE_URL)"
NYS_KEY="$(read_canon_key NYS_KNOWLEDGE_API_KEY)"

echo "=== NYS CONFIG (names only) ==="
echo "NYS_URL_set=$([ -n "$NYS_URL" ] && echo yes || echo no)"
echo "NYS_KEY_len=$(printf %s "$NYS_KEY" | wc -c | tr -d ' ')"
echo "NYS_KNOWLEDGE_TIMEOUT_MS=$(docker exec nyv-gateway printenv NYS_KNOWLEDGE_TIMEOUT_MS 2>/dev/null || echo unset)"

echo "=== NYS healthz direct ==="
curl -sS -m 10 -o /tmp/nys_h.json -w "http=%{http_code} t=%{time_total}s\n" \
  -H "X-API-Key: $NYS_KEY" "${NYS_URL%/}/healthz" 2>/dev/null || echo "healthz_failed"
head -c 200 /tmp/nys_h.json 2>/dev/null
echo

echo "=== NYS CNR direct (bypass NYV) ==="
for cnr in TSWL000000742024 RJHC010324382023; do
  tmp=$(mktemp)
  start_ms=$(date +%s%3N 2>/dev/null || python3 -c 'import time; print(int(time.time()*1000))')
  code=$(curl -sS -o "$tmp" -w '%{http_code}' -m 60 -X POST \
    -H "X-API-Key: $NYS_KEY" -H "Content-Type: application/json" \
    -d "{\"cnr\":\"$cnr\",\"options\":{\"includeDocuments\":false}}" \
    "${NYS_URL%/}/cnr/resolve" 2>/dev/null || echo ERR)
  end_ms=$(date +%s%3N 2>/dev/null || python3 -c 'import time; print(int(time.time()*1000))')
  ms=$((end_ms - start_ms))
  python3 - "$cnr" "$code" "$ms" "$tmp" <<'PY'
import json, sys
cnr, code, ms, path = sys.argv[1:5]
try:
    d = json.load(open(path))
    data = d.get("data") or {}
    err = d.get("error") or {}
    print(
        f"NYS_DIRECT {cnr} http={code} ms={ms} status={data.get('status')} "
        f"source={data.get('source')} latencyMs={data.get('meta', {}).get('latencyMs')} "
        f"err={err.get('code')}"
    )
except Exception as e:
    print(f"NYS_DIRECT {cnr} http={code} ms={ms} parse_err={e} body={open(path).read()[:120]}")
PY
  rm -f "$tmp"
done

echo "=== NYV CNR via localhost gateway ==="
for cnr in TSWL000000742024 RJHC010324382023; do
  tmp=$(mktemp)
  start_ms=$(date +%s%3N 2>/dev/null || python3 -c 'import time; print(int(time.time()*1000))')
  code=$(curl -sS -o "$tmp" -w '%{http_code}' -m 60 -X POST \
    -H "X-API-Key: $NSPK" -H "X-NYV-Platform: nsp" -H "Content-Type: application/json" \
    -d "{\"cnr\":\"$cnr\",\"claimEcourts\":false}" \
    "http://localhost:5000/api/jrx/v1/sdk/cnr/resolve" 2>/dev/null || echo ERR)
  end_ms=$(date +%s%3N 2>/dev/null || python3 -c 'import time; print(int(time.time()*1000))')
  ms=$((end_ms - start_ms))
  python3 - "$cnr" "$code" "$ms" "$tmp" <<'PY'
import json, sys
cnr, code, ms, path = sys.argv[1:5]
try:
    d = json.load(open(path))
    data = d.get("data") or {}
    err = d.get("error") or {}
    print(
        f"NYV_LOCAL {cnr} http={code} ms={ms} status={data.get('status')} "
        f"source={data.get('source')} err={err.get('code')}:{str(err.get('message', ''))[:80]}"
    )
except Exception as e:
    print(f"NYV_LOCAL {cnr} http={code} ms={ms} parse_err={e} body={open(path).read()[:120]}")
PY
  rm -f "$tmp"
done

echo "=== GATEWAY CNR LOGS (2h) ==="
docker logs nyv-gateway --since 2h 2>&1 | grep -iE 'CNR|cnr/resolve|NYS knowledge' | tail -30 || echo none

echo "=== PROBE DONE ==="
