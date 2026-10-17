#!/usr/bin/env bash
# =====================================================================
# nv-smoke-ec2.sh — canonical end-to-end smoke against the live EC2
# gateway at api.nyayasiddhi.online.
#
# Two modes:
#   public-only (default)  : public/health/download endpoints + auth
#                            negative-path validation. No SDK keys
#                            required.
#   full                   : adds authenticated 5-platform × N-route
#                            matrix. Requires SDK keys in Replit Secrets:
#                              NYV_SDK_KEY_NYM, NYV_SDK_KEY_NSP,
#                              NYV_SDK_KEY_NSI, NYV_SDK_KEY_NSA,
#                              NYV_SDK_KEY_NSM
#
# Usage:
#   bash scripts/jrx-smoke-ec2.sh                 # public-only
#   bash scripts/jrx-smoke-ec2.sh full            # full (needs secrets)
#   bash scripts/jrx-smoke-ec2.sh full https://api.nyayasiddhi.online
#
# Output:
#   - human summary on stdout
#   - structured JSON ledger to audit/smoke-<UTC-timestamp>.json
# =====================================================================

set -uo pipefail

MODE="${1:-public-only}"
GATEWAY="${2:-https://api.nyayasiddhi.online}"
STAMP="$(date -u +%Y-%m-%dT%H%M%SZ)"
AUDIT_DIR="${AUDIT_DIR:-audit}"
mkdir -p "$AUDIT_DIR"
OUT="$AUDIT_DIR/smoke-${STAMP}.json"

PACKAGES=(client-sdk client-sdk-react-native nyayamitra-sdk types react-hooks enterprise-sdk)
SDK_VERSION="5.0.0"

PASS=0
FAIL=0
SKIP=0
RESULTS=()

emit() {
  local name="$1" status="$2" code="$3" detail="$4"
  RESULTS+=("$(printf '{"name":%s,"status":%s,"http":%s,"detail":%s}' \
    "$(printf '%s' "$name" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))')" \
    "$(printf '%s' "$status" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))')" \
    "$(printf '%s' "$code" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))')" \
    "$(printf '%s' "$detail" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))')")")
  case "$status" in
    PASS) PASS=$((PASS+1)); printf "  \e[32m✓\e[0m %-50s [%s]\n" "$name" "$code" ;;
    FAIL) FAIL=$((FAIL+1)); printf "  \e[31m✗\e[0m %-50s [%s] %s\n" "$name" "$code" "$detail" ;;
    SKIP) SKIP=$((SKIP+1)); printf "  \e[33m·\e[0m %-50s [%s] %s\n" "$name" "$code" "$detail" ;;
  esac
}

check() {
  local name="$1" url="$2" expected="$3" auth="${4:-}"
  local code
  if [[ -n "$auth" ]]; then
    code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 30 \
      -H "Authorization: Bearer $auth" "$url" 2>&1) || code="000"
  else
    code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 30 "$url" 2>&1) || code="000"
  fi
  if [[ "$code" == "$expected" ]]; then
    emit "$name" "PASS" "$code" ""
  else
    emit "$name" "FAIL" "$code" "expected $expected"
  fi
}

check_download() {
  local pkg="$1"
  local url="${GATEWAY}/api/jrx/sdk/downloads/sdk/${pkg}/${SDK_VERSION}.tgz"
  local tmp; tmp="$(mktemp)"
  local code
  code=$(curl -fsSL --max-time 60 -o "$tmp" -w '%{http_code}' "$url" 2>/dev/null) || code="000"
  if [[ "$code" == "200" ]]; then
    local sha; sha=$(shasum -a 256 "$tmp" 2>/dev/null | cut -c1-16)
    local size; size=$(stat -c%s "$tmp" 2>/dev/null || stat -f%z "$tmp" 2>/dev/null)
    emit "download:${pkg}" "PASS" "$code" "size=${size}B sha256=${sha}…"
  else
    emit "download:${pkg}" "FAIL" "$code" "non-200"
  fi
  rm -f "$tmp"
}

echo "════════════════════════════════════════════════════════════════"
echo "  Nyayavigya EC2 Smoke — $STAMP"
echo "  Gateway: $GATEWAY"
echo "  Mode:    $MODE"
echo "════════════════════════════════════════════════════════════════"
echo

echo "── public/health endpoints ──"
check "health.api"               "${GATEWAY}/api/jrx/health"             "200"
# /gateway/health and /downloads/sdk/* are SDK-key gated by design
# (they ride sdkApiKeyRateLimit + sdkGatewayAuth). In public-only mode
# we only assert that they enforce auth (401 without Bearer).
check "auth-gated.gateway.health" "${GATEWAY}/api/jrx/gateway/health"     "401"
check "auth-gated.downloads.list" "${GATEWAY}/api/jrx/sdk/downloads/sdk"  "401"
echo

echo "── SDK tarball download auth-gating (6 packages × ${SDK_VERSION}) ──"
for p in "${PACKAGES[@]}"; do
  check "auth-gated.download:${p}" "${GATEWAY}/api/jrx/sdk/downloads/sdk/${p}/${SDK_VERSION}.tgz" "401"
done
echo

echo "── auth negative-path validation (NYV-NS-012/013/015 regression guard) ──"
check "unauth.create-app.401"   "${GATEWAY}/api/jrx/sdk/provision/create-app"   "401"
check "unauth.provision.401"    "${GATEWAY}/api/jrx/sdk/provision"              "401"
check "badauth.health.401"      "${GATEWAY}/api/jrx/sdk/provision/health"       "401" "nyv_live_sk_INVALID"
echo

if [[ "$MODE" == "full" ]]; then
  echo "── full mode: 5-platform key matrix ──"
  declare -A PLATFORM_KEYS=(
    [NYM]="${NYV_SDK_KEY_NYM:-}"
    [NSP]="${NYV_SDK_KEY_NSP:-}"
    [NSI]="${NYV_SDK_KEY_NSI:-}"
    [NSA]="${NYV_SDK_KEY_NSA:-}"
    [NSM]="${NYV_SDK_KEY_NSM:-}"
  )
  for plat in NYM NSP NSI NSA NSM; do
    key="${PLATFORM_KEYS[$plat]}"
    if [[ -z "$key" ]]; then
      emit "full:${plat}.key-missing" "SKIP" "—" "set NYV_SDK_KEY_${plat} in Replit Secrets"
      continue
    fi
    check "full:${plat}.gateway.health"   "${GATEWAY}/api/jrx/gateway/health"   "200" "$key"
    check "full:${plat}.agents"           "${GATEWAY}/api/jrx/gateway/agents"   "200" "$key"
    check "full:${plat}.provision.health" "${GATEWAY}/api/jrx/sdk/provision/health" "400" "$key"
  done
  echo
fi

TOTAL=$((PASS+FAIL+SKIP))
echo "════════════════════════════════════════════════════════════════"
printf "  Result: \e[32m%d PASS\e[0m / \e[31m%d FAIL\e[0m / \e[33m%d SKIP\e[0m  (total %d)\n" "$PASS" "$FAIL" "$SKIP" "$TOTAL"
echo "  Audit:  $OUT"
echo "════════════════════════════════════════════════════════════════"

JOINED="$(IFS=,; echo "${RESULTS[*]}")"
printf '{"timestamp":"%s","gateway":"%s","mode":"%s","summary":{"pass":%d,"fail":%d,"skip":%d,"total":%d},"results":[%s]}\n' \
  "$STAMP" "$GATEWAY" "$MODE" "$PASS" "$FAIL" "$SKIP" "$TOTAL" "$JOINED" > "$OUT"

[[ "$FAIL" -eq 0 ]]
