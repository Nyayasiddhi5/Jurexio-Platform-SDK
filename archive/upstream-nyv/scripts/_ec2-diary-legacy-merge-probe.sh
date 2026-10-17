#!/usr/bin/env bash
# NV-CNR-DIARY-LEGACY-MERGE-001 — SC diary + caseCreate + legacy P2a on nysdev.
# NV-SECRETS-001: key length only; no secret echo.
set -uo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
API="https://api.nyayasiddhi.online"

read_canon_key() {
  grep -E "^${1}=" "$CANON" 2>/dev/null | head -1 | cut -d= -f2- \
    | sed -E 's/^[[:space:]"'\'' ]+//; s/[[:space:]"'\'' ]+$//; s/\r$//'
}

NSPK="$(read_canon_key NYV_SDK_KEY_NSP)"
LEGACY_FLAG="$(read_canon_key NYV_F_CASE_API_LEGACY_ENRICH)"
echo "=== DIARY LEGACY MERGE PROBE $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo "NSP_key_len=$(printf %s "$NSPK" | wc -c | tr -d ' ')"
echo "NYV_F_CASE_API_LEGACY_ENRICH=${LEGACY_FLAG:-unset}"
if [ "$(printf %s "$NSPK" | wc -c)" -le 16 ]; then echo "SKIP no NSP key"; exit 1; fi

BODY='{"diaryNumber":"17329/2025","options":{"courtType":"sc","profile":"caseCreate","includeDocuments":true,"includeExtractPreview":true}}'
tmp=$(mktemp)
code=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time 120 -X POST \
  -H "X-API-Key: $NSPK" -H "X-NYV-Platform: nsp" -H "X-Client-ID: nsp-web" \
  -H "Content-Type: application/json" -d "$BODY" \
  "$API/api/jrx/v1/sdk/cnr/resolve" 2>/dev/null || echo ERR)

python3 - "$code" "$tmp" <<'PY'
import json, sys
code, path = sys.argv[1:3]
raw = open(path).read()
try:
    d = json.loads(raw) if raw.strip() else {}
except json.JSONDecodeError:
    print("PARSE_FAIL", code)
    sys.exit(2)
data = d.get("data") or {}
fields = data.get("fields") or {}
hearings = (fields.get("hearings") or {}).get("value") if isinstance(fields.get("hearings"), dict) else []
acts = (fields.get("actsSections") or {}).get("value") if isinstance(fields.get("actsSections"), dict) else []
sources = data.get("sourcesTried") or []
legacy_tiers = [s for s in sources if any(x in s for x in ("athena", "cnr_case_details", "nys_rds", "diary"))]
print(f"http={code} status={data.get('status')} lookupType={data.get('lookupType')} cnr_len={len(data.get('cnr') or '')}")
print(f"hearings={len(hearings) if isinstance(hearings, list) else 0} acts={len(acts) if isinstance(acts, list) else 0}")
print(f"extractPreview={'yes' if data.get('extractPreview') else 'no'} legacy_tiers={legacy_tiers[:6]}")
print(f"sourcesTried_count={len(sources)}")
ok = code in ("200", "201") and data.get("status") == "found"
sys.exit(0 if ok else 3)
PY
