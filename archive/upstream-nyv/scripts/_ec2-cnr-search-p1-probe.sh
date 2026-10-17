#!/usr/bin/env bash
# NV-LEGAL-SEARCH-MATTER-DISCOVERY-001 — post-deploy P1 search + filing-ref probe.
# Runs ON nysdev EC2. NV-SECRETS-001: counts/lengths only, no secret values.
set -uo pipefail

CANON="/opt/Nyayavigya/secrets/.env.production"
API="https://api.nyayasiddhi.online"
DEPLOY_DIR="/opt/nyayavigya/repo/CURRENT_DEPLOY"

read_canon_key() {
  grep -E "^${1}=" "$CANON" 2>/dev/null | head -1 | cut -d= -f2- \
    | sed -E 's/^[[:space:]"'\'' ]+//; s/[[:space:]"'\'' ]+$//; s/\r$//'
}

NSPK="$(read_canon_key NYV_SDK_KEY_NSP)"

probe_search() {
  local label="$1" qs="$2"
  local tmp; tmp=$(mktemp)
  local start_ms end_ms ms code
  start_ms=$(date +%s%3N 2>/dev/null || python3 -c 'import time;print(int(time.time()*1000))')
  code=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time 120 -G \
    -H "X-API-Key: $NSPK" -H "X-NYV-Platform: nsp" \
    --data-urlencode "court_type=hc" \
    --data-urlencode "party_name=STATE" \
    --data-urlencode "page=1" \
    --data-urlencode "page_size=3" \
    --data-urlencode "want_total=true" \
    $qs \
    "$API/api/jrx/v1/sdk/cnr/search" 2>/dev/null || echo ERR)
  end_ms=$(date +%s%3N 2>/dev/null || python3 -c 'import time;print(int(time.time()*1000))')
  ms=$((end_ms - start_ms))
  python3 - "$label" "$code" "$ms" "$tmp" <<'PY'
import json, sys
label, code, ms, path = sys.argv[1:5]
try:
    raw = open(path).read()
    d = json.loads(raw) if raw.strip() else {}
    data = d.get("data") or d
    items = data.get("items") or data.get("cases") or []
    meta = data.get("meta") or {}
    print(
        f"SEARCH {label} http={code} ms={ms} success={d.get('success')} "
        f"count={len(items) if isinstance(items, list) else 0} "
        f"total={meta.get('total') or data.get('total')!r} "
        f"forwarded={meta.get('forwardedFilters') or meta.get('filters')!r}"
    )
except Exception as e:
    print(f"SEARCH {label} http={code} ms={ms} parse_err={e} body_head={open(path).read()[:120]}")
PY
  rm -f "$tmp"
}

probe_filing_resolve() {
  local label="$1" body="$2"
  local tmp; tmp=$(mktemp)
  local start_ms end_ms ms code
  start_ms=$(date +%s%3N 2>/dev/null || python3 -c 'import time;print(int(time.time()*1000))')
  code=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time 120 -X POST \
    -H "X-API-Key: $NSPK" -H "X-NYV-Platform: nsp" -H "Content-Type: application/json" \
    -d "$body" "$API/api/jrx/v1/sdk/cnr/resolve" 2>/dev/null || echo ERR)
  end_ms=$(date +%s%3N 2>/dev/null || python3 -c 'import time;print(int(time.time()*1000))')
  ms=$((end_ms - start_ms))
  python3 - "$label" "$code" "$ms" "$tmp" <<'PY'
import json, sys
label, code, ms, path = sys.argv[1:5]
try:
    raw = open(path).read()
    d = json.loads(raw) if raw.strip() else {}
    data = d.get("data") or d
    meta = data.get("meta") or {}
    print(
        f"FILING {label} http={code} ms={ms} success={d.get('success')} "
        f"status={data.get('status')} source={data.get('source') or meta.get('tier')!r} "
        f"cnr={data.get('cnr')!r} caseNumber={data.get('caseNumber')!r} "
        f"searchThenResolve={meta.get('searchThenResolve') or (meta.get('extra') or {}).get('filingNumber')!r}"
    )
except Exception as e:
    print(f"FILING {label} http={code} ms={ms} parse_err={e} body_head={open(path).read()[:120]}")
PY
  rm -f "$tmp"
}

echo "=== CNR SEARCH P1 PROBE $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo "NSP_key_len=$(printf %s "$NSPK" | wc -c | tr -d ' ')"

if [ -L "$DEPLOY_DIR" ] || [ -d "$DEPLOY_DIR" ]; then
  echo "CURRENT_DEPLOY=$(readlink -f "$DEPLOY_DIR" 2>/dev/null || echo "$DEPLOY_DIR")"
  if [ -f "$DEPLOY_DIR/.deploy-meta" ]; then
    cat "$DEPLOY_DIR/.deploy-meta" 2>/dev/null || true
  fi
fi

if [ -f /opt/nyayavigya/deploys.log ]; then
  echo "last_deploy_line=$(tail -1 /opt/nyayavigya/deploys.log)"
fi

health_code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$API/api/jrx/health" 2>/dev/null || echo ERR)
health_body=$(curl -sS --max-time 15 "$API/api/jrx/health" 2>/dev/null || echo '{}')
echo "health_http=$health_code"
python3 - "$health_body" <<'PY'
import json, sys
try:
    d = json.loads(sys.argv[1])
    print(f"health_sha={d.get('gitSha') or d.get('sha') or d.get('commit')!r}")
except Exception as e:
    print(f"health_parse_err={e}")
PY

# P1-A: search filter passthrough (party_name + court_type=hc)
probe_search "P1-A-hc-party" ""

# P1-B: DC filing-ref search-then-resolve (known TG/AP shape — may be not_found if corpus gap)
probe_filing_resolve "P1-B-dc-filing" \
  '{"filingNumber":"25600000794","filingYear":"2025","options":{"courtType":"dc"}}'

echo "=== PROBE DONE ==="
