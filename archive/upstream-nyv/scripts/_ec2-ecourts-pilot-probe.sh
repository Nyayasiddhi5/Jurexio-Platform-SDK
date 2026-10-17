#!/usr/bin/env bash
# NV-ECOURTS-PILOT-001 — key/cookie length probe + optional Tier-4b smoke (nysdev). NV-SECRETS-001.
set -uo pipefail
echo "=== ECOURTS PILOT PROBE $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
SECRETS="${NYV_SECRETS_FILE:-/opt/Nyayavigya/secrets/.env.production}"
if [ -r "$SECRETS" ]; then
  for key in NYV_ECOURTS_API_KEY NYV_ECOURTS_SESSION_COOKIE NYV_F_ECOURTS_LIVE_FETCH NYV_F_ECOURTS_PORTAL_FETCH; do
    line=$(grep -E "^${key}=" "$SECRETS" 2>/dev/null | head -1 || true)
    if [ -z "$line" ]; then
      echo "${key}_PRESENT=no"
    elif [[ "$key" == NYV_F_* ]]; then
      val="${line#*=}"
      echo "${key}=${val}"
    else
      len=$(printf %s "${line#*=}" | wc -c | tr -d ' ')
      echo "${key}_LEN=${len}"
    fi
  done
else
  echo "SECRETS_FILE missing path=$SECRETS"
fi

health=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 http://127.0.0.1:5000/health 2>/dev/null || echo ERR)
echo "GATEWAY_HEALTH http=$health"

# Tier-4b enqueue smoke (expect disabled or missing cookie — evidence only)
body='{"cnr":"TSWL000000742024","options":{"courtType":"hc"}}'
http=$(curl -sS -o /tmp/ecourts-pilot.json -w '%{http_code}' --max-time 20 \
  -H 'Content-Type: application/json' \
  -d "$body" \
  http://127.0.0.1:5000/api/jrx/v1/sdk/cnr/live-fetch 2>/dev/null || echo ERR)
if [ -f /tmp/ecourts-pilot.json ]; then
  python3 - "$http" /tmp/ecourts-pilot.json <<'PY'
import json, sys
http, path = sys.argv[1:3]
try:
  d = json.load(open(path))
  keys = sorted(d.keys())[:12]
  print(f"LIVE_FETCH_SMOKE http={http} keys={keys} status={d.get('status')} code={d.get('code')}")
except Exception as e:
  print(f"LIVE_FETCH_SMOKE http={http} parse_err={e}")
PY
else
  echo "LIVE_FETCH_SMOKE http=$http no_body"
fi
echo "=== ECOURTS PILOT PROBE DONE ==="
