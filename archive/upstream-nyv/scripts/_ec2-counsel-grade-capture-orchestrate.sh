#!/usr/bin/env bash
# NV-COUNSEL-GRADE-EVAL-001 — capture live ORCHESTRATE responses on nysdev.
#
# Read-only. POSTs to /api/jrx/orchestrate only; no restart, no recreate, no deploy.
#
# Runs ONE case per invocation (`--only <caseId>`). Deliberate: a research or draft
# orchestrate measures 55–65 s, and batching three of them into one SSM invocation
# is how an earlier probe hit a client timeout and mis-reported a working platform
# as broken. One case, one budget, one payload.
#
# The prompt is passed in base64 so quotes and newlines in a legal prompt cannot
# break the shell (SSM runs the command list with `sh`).
#
# NV-VALIDATE-THE-PROBE-001 controls:
#   C1 — key_len must be 64. 0 means the env read failed and the 401 that follows
#        is MY fault, not a quality collapse.
#   C2 — http must be 200 AND the body must be JSON. A 2 ms HTML body means the
#        request never reached the gateway.
set -uo pipefail

CASE_ID="${CASE_ID:?CASE_ID required}"
BODY_B64="${BODY_B64:?BODY_B64 required}"
BUDGET="${BUDGET:-200}"

BASE="http://127.0.0.1:5000"
KEY="$(docker exec nyv-gateway printenv NYV_SDK_KEY_NSP 2>/dev/null || true)"
echo "CONTROL C1 key_len=${#KEY} (MUST be 64)"
if [[ "${#KEY}" -lt 32 ]]; then
  echo "PROBE BROKEN — could not read the partner key. Aborting without blaming the platform."
  exit 2
fi

WORK="$(mktemp -d)"
printf '%s' "$BODY_B64" | base64 -d > "${WORK}/req.json"
echo "CONTROL request_bytes=$(wc -c < "${WORK}/req.json") (0 would mean the payload never arrived)"

t0=$(date +%s%3N)
raw="$(curl -s -w $'\n%{http_code}' --max-time "$BUDGET" \
  -H "x-api-key: ${KEY}" \
  -H "x-nyv-platform: nsp" \
  -H "x-nyv-consent: granted" \
  -H "content-type: application/json" \
  -X POST --data-binary "@${WORK}/req.json" \
  "${BASE}/api/jrx/orchestrate" 2>/dev/null || printf '\n000')"
t1=$(date +%s%3N)

code="$(printf '%s' "$raw" | tail -n1)"
code="$((10#${code:-0}))"
body="$(printf '%s' "$raw" | sed '$d')"
echo "CONTROL C2 http=${code} ms=$((t1-t0)) bytes=${#body} first_char=$(printf '%s' "$body" | head -c1)"

OUT="${WORK}/captured.json"
printf '{"%s": {"httpStatus": %s, "latencyMs": %s, "response": ' "$CASE_ID" "$code" "$((t1-t0))" > "$OUT"
if [[ "$code" == "0" ]]; then
  printf 'null, "transportError": "curl transport failure / timeout after %s ms (budget %ss)"' "$((t1-t0))" "$BUDGET" >> "$OUT"
elif printf '%s' "$body" | head -c1 | grep -q '[{[]'; then
  printf '%s' "$body" >> "$OUT"
else
  printf 'null, "transportError": "non-JSON response (%s bytes) — ingress hop, not the gateway"' "${#body}" >> "$OUT"
fi
printf '}}' >> "$OUT"

echo "CAPTURE bytes=$(wc -c < "$OUT")"
echo "PAYLOAD_BEGIN"
gzip -9 -c "$OUT" | base64 -w0
echo ""
echo "PAYLOAD_END"
rm -rf "$WORK"
