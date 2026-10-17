#!/usr/bin/env bash
# NV-CNR-UNIFIED-CASCADE-001 — post-deploy unified cascade probe.
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
CASCADE_FLAG="$(read_canon_key NYV_F_CNR_UNIFIED_CASCADE)"
CASE_FLAG="$(read_canon_key NYV_F_CASE_API_CNR)"

probe_json() {
  local label="$1" body="$2"
  local tmp; tmp=$(mktemp)
  local start_ms end_ms ms code
  start_ms=$(date +%s%3N 2>/dev/null || python3 -c 'import time;print(int(time.time()*1000))')
  code=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time 180 -X POST \
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
    extra = meta.get("extra") or {}
    sources = data.get("sourcesTried") or []
    cascade_id = extra.get("cascade")
    case_api_status = extra.get("caseApiAttemptStatus")
    print(
        f"PROBE {label} http={code} ms={ms} success={d.get('success')} "
        f"status={data.get('status')} source={data.get('source') or meta.get('tier')} "
        f"sourcesTried={sources!r} cascade={cascade_id!r} "
        f"caseApiAttempt={case_api_status!r} claimEcourts={data.get('claimEcourts')} "
        f"cnr={data.get('cnr')!r}"
    )
    legacy_hit = any(
        s in sources
        for s in ("nys_rds", "opendata_athena_case_details", "siddhanta_s3", "cnr_case_details")
    )
    print(f"PROBE {label} legacy_tier_hit={legacy_hit} nys_case_api_in_sources={'nys_case_api' in sources}")
except Exception as e:
    print(f"PROBE {label} http={code} ms={ms} parse_err={e} body_head={open(path).read()[:160]}")
PY
  rm -f "$tmp"
}

echo "=== CNR UNIFIED CASCADE PROBE $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo "NSP_key_len=$(printf %s "$NSPK" | wc -c | tr -d ' ')"
echo "NYV_F_CASE_API_CNR=${CASE_FLAG:-unset} NYV_F_CNR_UNIFIED_CASCADE=${CASCADE_FLAG:-unset}"

if [ -L "$DEPLOY_DIR" ] || [ -d "$DEPLOY_DIR" ]; then
  echo "CURRENT_DEPLOY=$(readlink -f "$DEPLOY_DIR" 2>/dev/null || echo "$DEPLOY_DIR")"
  if [ -f "$DEPLOY_DIR/.deploy-meta" ]; then
    cat "$DEPLOY_DIR/.deploy-meta" 2>/dev/null || true
  fi
  if [ -d "$DEPLOY_DIR" ]; then
    git -C "$DEPLOY_DIR" rev-parse --short HEAD 2>/dev/null | xargs -I{} echo "DEPLOY_SHA={}"
  fi
fi

if [ -f /opt/nyayavigya/deploys.log ]; then
  echo "last_deploy_line=$(tail -1 /opt/nyayavigya/deploys.log)"
elif [ -f /opt/Nyayavigya/deploys.log ]; then
  echo "last_deploy_line=$(tail -1 /opt/Nyayavigya/deploys.log)"
fi

health_body=$(curl -sS --max-time 15 "$API/api/jrx/health" 2>/dev/null || echo '{}')
health_code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$API/api/jrx/health" 2>/dev/null || echo ERR)
echo "health_http=$health_code"
python3 - "$health_body" <<'PY'
import json, sys
try:
    d = json.loads(sys.argv[1])
    cnr = d.get("cnr") or {}
    print(
        f"health_sha={d.get('gitSha') or d.get('sha') or d.get('commit')!r} "
        f"unifiedCascade={cnr.get('unifiedCascade')!r} "
        f"ecourtsLiveFetch={cnr.get('ecourtsLiveFetch')!r} "
        f"caseApiCnr={cnr.get('caseApiCnr')!r}"
    )
except Exception as e:
    print(f"health_parse_err={e}")
PY

cnr_health=$(curl -sS --max-time 15 "$API/api/jrx/v1/sdk/cnr/health" \
  -H "X-API-Key: $NSPK" -H "X-NYV-Platform: nsp" 2>/dev/null || echo '{}')
python3 - "$cnr_health" <<'PY'
import json, sys
try:
    d = json.loads(sys.argv[1])
    print(f"cnr_health unifiedCascade={d.get('unifiedCascade')!r} cascadeId={d.get('cascadeId')!r}")
except Exception:
    pass
PY

if [ "$(printf %s "$NSPK" | wc -c)" -le 16 ]; then echo "SKIP no NSP key"; exit 1; fi

# Regression — known DC found via case-api (P1 path still works)
probe_json "REG_DC_FOUND" \
  '{"identifier":"DLCT010001232023","options":{"profile":"caseCreate","courtType":"dc"}}'

# DC CNR often missing from case-api index — cascade should try legacy/Athena tiers
probe_json "CASCADE_DC_GAP" \
  '{"identifier":"TSWL010000012024","options":{"profile":"caseCreate","courtType":"dc"}}'

# HC CNR with Athena enrichment on found path (P2a legacy merge)
probe_json "CASCADE_HC_ATHENA" \
  '{"identifier":"TSWL000000742024","options":{"profile":"caseCreate","courtType":"dc"}}'

# SC diary regression
probe_json "REG_SC_DIARY" \
  '{"identifier":"173292025","options":{"profile":"caseCreate"}}'

echo "=== CASCADE PROBE DONE ==="
