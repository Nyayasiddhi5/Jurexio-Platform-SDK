#!/usr/bin/env bash
# NV-ONBOARDING-EXTRACT-PROBE-001 — nysdev smoke (synthetic PAN text as minimal PDF would need file; use text fixture via agent path).
set -euo pipefail
NSP_KEY="$(grep -E '^NYV_SDK_KEY_NSP=' /opt/Nyayavigya/secrets/.env.production | head -1 | sed 's/^NYV_SDK_KEY_NSP=//; s/^"//; s/"$//')"
echo "NSP_key_len=${#NSP_KEY}"
# Minimal PNG (same as docparse visual probe)
TINY_B64="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
HTTP="$(curl -sS -o /tmp/onb_extract.json -w '%{http_code}' \
  -H "X-API-Key: ${NSP_KEY}" \
  -H "X-NYV-Platform: nsp-pro" \
  -H "Content-Type: application/json" \
  -d "{\"base64\":\"${TINY_B64}\",\"fileName\":\"pan-probe.png\",\"mimeType\":\"image/png\",\"documentHint\":\"panCard\",\"ingestRole\":\"onboarding_kyc\"}" \
  http://127.0.0.1:5000/api/jrx/v1/sdk/docparse/nsp/onboarding-extract)"
echo "onboarding_extract_http=${HTTP}"
python3 - <<'PY'
import json
d=json.load(open("/tmp/onb_extract.json"))
print("success", d.get("success"))
data=d.get("data") or {}
print("mode", data.get("mode"), "domainPackId", data.get("domainPackId"))
print("has_onboardingForm", bool(data.get("onboardingForm")))
print("has_userProfile", data.get("userProfile") is not None)
print("has_companyProfile", data.get("companyProfile") is not None)
PY
[ "$HTTP" = "200" ] && echo "ONBOARDING_EXTRACT_PROBE=PASS" || { echo "ONBOARDING_EXTRACT_PROBE=FAIL"; exit 1; }
