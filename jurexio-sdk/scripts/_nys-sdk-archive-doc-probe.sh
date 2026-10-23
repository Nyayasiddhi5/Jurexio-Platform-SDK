#!/usr/bin/env bash
# Prove the SDK archive-document defect and its fix against the LIVE NYS host,
# from the host itself (curl is present here; it is NOT in the jrx-gateway
# container). Read-only: two GETs against /athena/document.
set -uo pipefail
echo "probe-positive-control 5150"
cd /opt/nyv/api || { echo "PROBE FAIL: /opt/nyv/api missing"; exit 1; }

KEY=$(grep -m1 '^JRX_ECOSYSTEM_SDK_API_KEYS=' .env 2>/dev/null | cut -d= -f2- | tr -d '"' | cut -d, -f1)
if [ -z "$KEY" ]; then
  KEY=$(grep -m1 '^JRX_ECOSYSTEM_KNOWLEDGE_API_KEY=' .env 2>/dev/null | cut -d= -f2- | tr -d '"')
fi
echo "api_key_len=${#KEY}"
[ "${#KEY}" -lt 8 ] && { echo "PROBE INVALID: no usable key found"; exit 1; }

S3="s3://your-supreme-court-data-bucket/data/tar/year=1973/english/S_1973_1_1_1002_EN.pdf"

probe() {
  local label="$1"; local qs="$2"
  local out
  out=$(curl -sS -m 25 -w '\nHTTP=%{http_code}' \
    -H "x-api-key: $KEY" \
    "http://127.0.0.1:8080/api/athena/document?${qs}" 2>&1)
  local code
  code=$(printf '%s' "$out" | sed -n 's/^HTTP=//p' | tail -1)
  local body
  body=$(printf '%s' "$out" | sed '$d' | head -c 220)
  echo "--- $label"
  echo "    http=$code"
  # Never print the presigned URL itself (it is a bearer credential); report shape only.
  echo "    body_shape=$(printf '%s' "$body" | sed -E 's#https://[^"]*#<presigned-url-redacted>#g' | head -c 200)"
}

probe "OLD SDK shape (archiveId=…) — expect 400" "archiveId=1973_1_1_1002"
probe "OLD SDK shape (id=…) — expect 400" "id=1973_1_1_1002"
probe "NEW SDK shape (s3Path=…) — expect 200" "s3Path=$S3"
echo "probe-done 5150"
