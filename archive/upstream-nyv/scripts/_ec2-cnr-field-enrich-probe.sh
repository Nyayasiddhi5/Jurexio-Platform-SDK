#!/usr/bin/env bash
# NV-CNR-FIELD-ENRICH-001 — acts/hearings/doc counts for RCA probes on nysdev.
# Runs ON nysdev EC2. NV-SECRETS-001: counts only, no secret values.
set -uo pipefail

CANON="/opt/Nyayavigya/secrets/.env.production"
API="https://api.nyayasiddhi.online"

read_canon_key() {
  grep -E "^${1}=" "$CANON" 2>/dev/null | head -1 | cut -d= -f2- \
    | sed -E 's/^[[:space:]"'\'' ]+//; s/[[:space:]"'\'' ]+$//; s/\r$//'
}

NSPK="$(read_canon_key NYV_SDK_KEY_NSP)"
LEGACY_FLAG="$(read_canon_key NYV_F_CASE_API_LEGACY_ENRICH)"
CURRENT="$(cat /opt/Nyayavigya/CURRENT_DEPLOY 2>/dev/null || echo missing)"

echo "=== CNR FIELD ENRICH PROBE $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo "CURRENT_DEPLOY=$CURRENT"
echo "NYV_F_CASE_API_LEGACY_ENRICH=${LEGACY_FLAG:-unset}"

probe() {
  local label="$1" body="$2"
  local tmp; tmp=$(mktemp)
  local start end ms code
  start=$(python3 -c 'import time;print(int(time.time()*1000))')
  code=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time 120 -X POST \
    -H "X-API-Key: $NSPK" -H "X-NYV-Platform: nsp" -H "Content-Type: application/json" \
    -d "$body" "$API/api/jrx/v1/sdk/cnr/resolve" 2>/dev/null || echo ERR)
  end=$(python3 -c 'import time;print(int(time.time()*1000))')
  ms=$((end - start))
  python3 - "$label" "$code" "$ms" "$tmp" <<'PY'
import json, sys
label, code, ms, fpath = sys.argv[1:5]
try:
    d = json.load(open(fpath))
    data = d.get('data') or {}
    fields = data.get('fields') or {}
    acts = fields.get('actsSections', {}).get('value') or []
    hearings = fields.get('hearings', {}).get('value') or []
    docs = data.get('documents') or []
    tl = (data.get('caseCreate') or {}).get('timeline') or []
    src = data.get('source') or '-'
    tried = data.get('sourcesTried') or []
    print(
        f"PROBE {label} http={code} ms={ms} status={data.get('status')} source={src} "
        f"acts={len(acts) if isinstance(acts, list) else 0} "
        f"hearings={len(hearings) if isinstance(hearings, list) else 0} "
        f"timeline={len(tl)} docs={len(docs)} "
        f"sourcesTried={len(tried)} cnr={data.get('cnr')!r} "
        f"diary={data.get('diaryNumber')!r}"
    )
except Exception as e:
    print(f"PROBE {label} http={code} ms={ms} parse_err={e}")
PY
  rm -f "$tmp"
}

probe "diary_17329_2025" '{"diaryNumber":"17329/2025","options":{"courtType":"sc","profile":"caseCreate","includeDocuments":true}}'
probe "cnr_TSWL" '{"cnr":"TSWL000000742024","options":{"profile":"caseCreate","includeDocuments":true}}'
probe "cnr_RJHC" '{"cnr":"RJHC010324382023","options":{"profile":"caseCreate","includeDocuments":true}}'
