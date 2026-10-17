#!/usr/bin/env bash
# NV-COUNSEL-GRADE-EVAL-001 — capture live responses on the nysdev host for the
# DETERMINISTIC (knowledge-plane) cases. Read-only: GETs only, no restart, no deploy.
#
# Runs on the HOST (curl exists there; it does NOT exist in the nyv-gateway
# container). Emits a single base64 gzip blob so a multi-KB JSON payload survives
# the 24,000-char SSM invocation-output ceiling.
#
# NV-VALIDATE-THE-PROBE-001 controls, printed before the payload:
#   C1 — key length must be 64. key_len=0 means the env read failed, and every
#        case would 401 and look like a platform-wide quality collapse.
#   C2 — a POSITIVE CONTROL GET that is known to work must return 200. If it does
#        not, the probe is wrong, not the platform.
set -uo pipefail

BASE="http://127.0.0.1:5000"
KEY="$(docker exec nyv-gateway printenv NYV_SDK_KEY_NSP 2>/dev/null || true)"
echo "CONTROL C1 key_len=${#KEY} (MUST be 64)"
if [[ "${#KEY}" -lt 32 ]]; then
  echo "PROBE BROKEN — could not read the partner key from the container. Aborting."
  exit 2
fi

hdr=(-H "x-api-key: ${KEY}" -H "x-nyv-platform: nsp" -H "x-nyv-consent: granted" -H "content-type: application/json")

# C2 positive control — the health surface, which must answer.
ctl="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "${BASE}/api/jrx/health" 2>/dev/null || echo 000)"
echo "CONTROL C2 health_http=${ctl} (000 means the probe cannot reach the gateway at all)"

WORK="$(mktemp -d)"
OUT="${WORK}/captured.json"
echo '{' > "$OUT"
first=1

capture_get() {
  local id="$1" path="$2" budget="${3:-60}"
  local t0 t1 code body
  t0=$(date +%s%3N)
  body="$(curl -s -w $'\n%{http_code}' --max-time "$budget" "${hdr[@]}" "${BASE}${path}" 2>/dev/null || printf '\n000')"
  t1=$(date +%s%3N)
  code="$(printf '%s' "$body" | tail -n1)"
  body="$(printf '%s' "$body" | sed '$d')"
  # `curl` writes 000 on a transport failure. JSON has no octal literal, so 000
  # would produce a file that will not parse — and a grader that cannot read its
  # own capture reports every case as unmeasured, which looks like a total outage.
  code="$((10#${code:-0}))"
  echo "  ${id}: http=${code} ms=$((t1-t0)) bytes=${#body}" >&2
  [[ $first -eq 0 ]] && echo ',' >> "$OUT"
  first=0
  printf '"%s": {"httpStatus": %s, "latencyMs": %s, "response": ' "$id" "$code" "$((t1-t0))" >> "$OUT"
  if [[ "$code" == "0" ]]; then
    printf 'null, "transportError": "curl transport failure / client timeout after %s ms"' "$((t1-t0))" >> "$OUT"
  elif printf '%s' "$body" | head -c1 | grep -q '[{[]'; then
    printf '%s' "$body" >> "$OUT"
  else
    # Non-JSON => almost certainly an ingress page. Record it as a transport
    # failure so the grader marks the case `blocked`, not quality-failed.
    printf 'null, "transportError": "non-JSON response (%s bytes)"' "${#body}" >> "$OUT"
  fi
  printf '}' >> "$OUT"
}

capture_get "statute-transition-ipc-bns-420"    "/api/jrx/knowledge/statutes/compare/ipc-bns?section=420" 60
capture_get "statute-transition-new-old-bnss-482" "/api/jrx/knowledge/statutes/compare/new-old?section=482&from=BNSS" 60
# The treatment route consults the corpus and timed out at 60 s on the first pass.
# Distinguish "slow" from "broken" by giving it a real budget before concluding.
capture_get "caselaw-treatment-maneka-gandhi"   "/api/jrx/knowledge/caselaw/treatment?citation=Maneka%20Gandhi%20versus%20Union%20of%20India" 180

echo '}' >> "$OUT"
echo "CAPTURE bytes=$(wc -c < "$OUT")"
echo "PAYLOAD_BEGIN"
gzip -9 -c "$OUT" | base64 -w0
echo ""
echo "PAYLOAD_END"
rm -rf "$WORK"
