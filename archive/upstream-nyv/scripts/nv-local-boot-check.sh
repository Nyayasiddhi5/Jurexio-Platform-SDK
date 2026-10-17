#!/usr/bin/env bash
# nv-local-boot-check.sh — Validate local boot prerequisites without echoing secrets.
#
# Usage:
#   cd nyayavigya-platform-312
#   bash scripts/jrx-local-boot-check.sh
#
# Loads .env if present (values are never printed). Exits 0 when the minimum
# vars for a DATABASE_URL-backed gateway boot are set.

set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "${GREEN}PASS${NC} $*"; }
fail() { echo -e "${RED}FAIL${NC} $*"; FAILURES=$((FAILURES + 1)); }
warn() { echo -e "${YELLOW}WARN${NC} $*"; }

FAILURES=0

check_set() {
  local name="$1"
  local value="${!name:-}"
  if [[ -n "$value" ]]; then
    pass "${name} is set"
  else
    fail "${name} is unset (see .env.local.example)"
  fi
}

echo ""
echo "══════════════════════════════════════════════════════════════"
echo "  NYV Local Boot Check — env presence only (no secret values)"
echo "══════════════════════════════════════════════════════════════"
echo ""

# Required for audit-chain self-test and Drizzle boot
check_set DATABASE_URL

# Canonical alias used by some services
if [[ -z "${NYV_DATABASE_URL:-}" && -n "${DATABASE_URL:-}" ]]; then
  warn "NYV_DATABASE_URL unset — DATABASE_URL will be used as fallback"
elif [[ -n "${NYV_DATABASE_URL:-}" ]]; then
  pass "NYV_DATABASE_URL is set"
else
  fail "NYV_DATABASE_URL is unset and DATABASE_URL missing"
fi

# Recommended for local Cursor dev (see .env.local.example)
for opt in NYV_REDIS_TCP_URL NYV_JWT_SECRET NYV_JWT_REFRESH_SECRET NV_PII_ENCRYPTION_KEY; do
  if [[ -n "${!opt:-}" ]]; then
    pass "${opt} is set"
  else
    warn "${opt} unset — some routes may fail or degrade"
  fi
done

if [[ -n "${NYV_SDK_KEY_NSP:-}" ]]; then
  pass "NYV_SDK_KEY_NSP is set (partner smoke can run authenticated steps)"
else
  warn "NYV_SDK_KEY_NSP unset — partner smoke will skip authenticated steps"
fi

echo ""
if [[ "$FAILURES" -eq 0 ]]; then
  echo -e "  ${GREEN}Result: PASS${NC} — minimum DATABASE_URL present for gateway boot"
  echo "  Next: npm run infra:local:up && npm run dev"
  exit 0
else
  echo -e "  ${RED}Result: FAIL${NC} (failures=${FAILURES})"
  echo "  Copy vars from .env.local.example into .env, then re-run."
  exit 1
fi
