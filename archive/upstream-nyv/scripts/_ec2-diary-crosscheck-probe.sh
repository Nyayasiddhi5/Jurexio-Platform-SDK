#!/usr/bin/env bash
# Diary crosscheck probe — runs ON nysdev EC2. NV-SECRETS-001: no key echo.
set -uo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
API="https://api.nyayasiddhi.online"

read_canon_key() {
  grep -E "^${1}=" "$CANON" 2>/dev/null | head -1 | cut -d= -f2- \
    | sed -E 's/^[[:space:]"'\'' ]+//; s/[[:space:]"'\'' ]+$//; s/\r$//'
}

NSPK="$(read_canon_key NYV_SDK_KEY_NSP)"
echo "=== DIARY CROSSCHECK PROBE $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo "NSP_key_len=$(printf %s "$NSPK" | wc -c | tr -d ' ')"
if [ "$(printf %s "$NSPK" | wc -c)" -le 16 ]; then echo "SKIP no NSP key"; exit 1; fi

probe() {
  local label="$1" body="$2"
  local tmp; tmp=$(mktemp)
  local start_ms end_ms ms code
  start_ms=$(date +%s%3N 2>/dev/null || python3 -c 'import time;print(int(time.time()*1000))')
  code=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time 120 -X POST \
    -H "X-API-Key: $NSPK" -H "X-NYV-Platform: nsp" -H "X-Client-ID: nsp-web" \
    -H "Content-Type: application/json" -d "$body" \
    "$API/api/jrx/v1/sdk/cnr/resolve" 2>/dev/null || echo ERR)
  end_ms=$(date +%s%3N 2>/dev/null || python3 -c 'import time;print(int(time.time()*1000))')
  ms=$((end_ms - start_ms))
  python3 - "$label" "$code" "$ms" "$body" "$tmp" <<'PY'
import json, sys
label, code, ms, req_body, path = sys.argv[1:6]
req = json.loads(req_body)
try:
    raw = open(path).read()
    d = json.loads(raw) if raw.strip() else {}
    data = d.get("data") or {}
    fields = data.get("fields") or {}
    def fv(k):
        v = fields.get(k)
        if isinstance(v, dict): return v.get("value")
        return v
    summary = {
        "label": label,
        "http": code,
        "ms": ms,
        "request": req,
        "response": {
            "success": d.get("success"),
            "source": d.get("source"),
            "claimEcourts": d.get("claimEcourts"),
            "data": {
                "status": data.get("status"),
                "lookupType": data.get("lookupType"),
                "diaryNumber": data.get("diaryNumber"),
                "cnr": data.get("cnr"),
                "source": data.get("source"),
                "matchType": data.get("matchType"),
                "confidence": data.get("confidence"),
                "sourcesTried": data.get("sourcesTried"),
                "ui": data.get("ui"),
                "meta": data.get("meta"),
                "fields_keys": sorted(fields.keys()) if fields else [],
                "petitioner": str(fv("petitioner") or "")[:80] or None,
                "respondent": str(fv("respondent") or "")[:80] or None,
                "courtName": str(fv("courtName") or "")[:80] or None,
                "diaryNumber_field": fv("diaryNumber"),
                "caseCreate_present": bool(data.get("caseCreate")),
                "documents_count": len(data.get("documents") or []),
            },
            "error": d.get("error"),
        }
    }
    print("=== " + label + " ===")
    print(json.dumps(summary, indent=2, default=str))
except Exception as e:
    print(f"ERR {label} http={code} ms={ms} err={e} body={open(path).read()[:200]}")
PY
  rm -f "$tmp"
}

# NSP postDiaryResolve shape (caseCreate profile)
probe "NSP_173292025_compact" '{"diaryNumber":"173292025","options":{"profile":"caseCreate","includeDocuments":true,"includeExtractPreview":true,"fuzzyLimit":5,"jurisdiction":"IN","courtType":"sc"}}'
probe "NSP_17329_slash" '{"diaryNumber":"17329/2025","options":{"profile":"caseCreate","includeDocuments":true,"includeExtractPreview":true,"fuzzyLimit":5,"jurisdiction":"IN","courtType":"sc"}}'
probe "NSP_508502026_compact" '{"diaryNumber":"508502026","options":{"profile":"caseCreate","includeDocuments":true,"includeExtractPreview":true,"fuzzyLimit":5,"jurisdiction":"IN","courtType":"sc"}}'
probe "NSP_17329_no_courtType" '{"diaryNumber":"17329/2025","options":{"profile":"caseCreate","includeDocuments":false,"jurisdiction":"IN"}}'
probe "NOTFOUND_99999_slash" '{"diaryNumber":"99999/2099","options":{"courtType":"sc","profile":"caseCreate","includeDocuments":false}}'
probe "INSC_2023" '{"diaryNumber":"2023 INSC 1081","options":{"courtType":"sc","includeDocuments":false}}'

echo "=== GATEWAY LOG TAIL (diary/cnr last 2h) ==="
docker logs nyayavigya-gateway-1 --since 2h 2>&1 | grep -iE 'diary|cnr/resolve|case-api diary' | tail -20 || echo "(no matching log lines)"

echo "=== PROBE DONE ==="
