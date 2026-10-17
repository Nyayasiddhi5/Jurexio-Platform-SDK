#!/usr/bin/env bash
# Baseline check against the CURRENTLY DEPLOYED NYS (unchanged code): confirm both
# landmark judgments still 413, and that a routine judgment still extracts. This
# is the "before" half of the NYS-ARCHIVE-LARGE-PDF-001 evidence; the "after"
# half cannot be measured over HTTP until NYS is deployed.
set -uo pipefail
echo "probe-positive-control 5150"
cd /opt/nyv/api || { echo "PROBE FAIL: /opt/nyv/api missing"; exit 1; }
KEY=$(grep -m1 '^NYS_SDK_API_KEYS=' .env 2>/dev/null | cut -d= -f2- | tr -d '"' | cut -d, -f1)
echo "api_key_len=${#KEY}"
[ "${#KEY}" -lt 8 ] && { echo "PROBE INVALID: no usable key"; exit 1; }

extract() {
  local label="$1"; local s3="$2"
  local t0 t1 out code
  t0=$(date +%s%3N)
  out=$(curl -sS -m 90 -w '\nHTTP=%{http_code}' -X POST \
    -H "x-api-key: $KEY" -H 'content-type: application/json' \
    -d "{\"s3Path\":\"$s3\"}" \
    "http://127.0.0.1:8080/api/athena/extract" 2>&1)
  t1=$(date +%s%3N)
  code=$(printf '%s' "$out" | sed -n 's/^HTTP=//p' | tail -1)
  local body; body=$(printf '%s' "$out" | sed '$d')
  echo "--- $label"
  echo "    http=$code latency_ms=$((t1 - t0))"
  echo "    byteSize=$(printf '%s' "$body" | grep -oE '"byteSize":[0-9]+' | head -1)"
  echo "    textLength=$(printf '%s' "$body" | grep -oE '"textLength":[0-9]+' | head -1)"
  echo "    cached=$(printf '%s' "$body" | grep -oE '"cached":(true|false)' | head -1)"
  echo "    truncated=$(printf '%s' "$body" | grep -oE '"truncated":(true|false)' | head -1)"
  echo "    error=$(printf '%s' "$body" | grep -oE '"error":"[^"]{0,150}' | head -1)"
}

B=s3://your-supreme-court-data-bucket/data/tar/year
extract "control 1973_1_40_52 (488 KB) — expect 200" "$B=1973/english/1973_1_40_52_EN.pdf"
extract "Kesavananda Bharati (35.8 MB) — expect 413 pre-deploy" "$B=1973/english/S_1973_1_1_1002_EN.pdf"
extract "Maneka Gandhi (60.9 MB) — expect 413 pre-deploy" "$B=1978/english/1978_2_621_776_EN.pdf"
echo "probe-done 5150"
