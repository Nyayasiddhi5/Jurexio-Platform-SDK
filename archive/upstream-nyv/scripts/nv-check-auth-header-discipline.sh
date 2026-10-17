#!/usr/bin/env bash
# NV-AUTH-HEADER-001 — Auth header discipline check (CI guardrail)
# Fails the build if any new SDK auth header is introduced outside the
# whitelisted internal-east-west file.
#
# Canonical contract:
#   - SDK external auth   → `X-API-Key` (extractSdkApiKey from
#                            src/middleware/jrx-sdk-auth-header.ts)
#   - Inter-service east-west → `X-NV-API-Key` (handled exclusively by
#                            src/middleware/jrx-inter-service-auth.ts)
#
# Forbidden anywhere in src/:
#   x-nv-sdk-key, x-sdk-key, x-nyv-key, x-nyv-api-key, x-platform-key
#
# Forbidden outside the inter-service file:
#   x-nv-api-key
#
# Run: bash scripts/jrx-check-auth-header-discipline.sh
# CI:  npm run guardrail:auth-header

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

EXIT=0

echo "[guardrail NV-AUTH-HEADER-001] checking SDK auth-header discipline…"

# 1. Forbidden header names anywhere in src/
FORBIDDEN_PATTERN='headers\[['"'"'"](x-nv-sdk-key|x-sdk-key|x-nyv-key|x-platform-key|x-nyv-api-key)['"'"'"]\]'
if rg -nP "$FORBIDDEN_PATTERN" src/ 2>/dev/null; then
  echo ""
  echo "  ✗ Forbidden SDK auth header detected. Use extractSdkApiKey() from"
  echo "    src/middleware/jrx-sdk-auth-header.ts. Canonical header: X-API-Key."
  EXIT=1
fi

# 2. x-nv-api-key allowed ONLY in nv-inter-service-auth.ts (east-west traffic)
INTER_HEADER_PATTERN='headers\[['"'"'"]x-nv-api-key['"'"'"]\]'
INTER_VIOLATIONS=$(rg -nP "$INTER_HEADER_PATTERN" src/ 2>/dev/null | grep -v 'src/middleware/jrx-inter-service-auth.ts' || true)
if [ -n "$INTER_VIOLATIONS" ]; then
  echo "$INTER_VIOLATIONS"
  echo ""
  echo "  ✗ x-nv-api-key is reserved for inter-service east-west traffic"
  echo "    (src/middleware/jrx-inter-service-auth.ts only)."
  EXIT=1
fi

# 3. New extractApiKey functions outside the canonical file are a smell —
#    they almost always re-introduce a divergent header set. Whitelist:
#      • src/middleware/jrx-sdk-auth-header.ts  (the canonical one)
#      • src/middleware/jrx-inter-service-auth.ts (different concern: east-west)
#      • src/routes/jrx-sdk-downloads-routes.ts (signed-URL download wrapper —
#        delegates to extractSdkApiKey() then adds a query-param fallback for
#        binary download links; documented exception, NOT generalizable)
EXTRACT_VIOLATIONS=$(rg -lP 'function\s+extractApiKey\s*\(' src/ 2>/dev/null | grep -vE './jrx-sdk-auth-header\.ts$|nv-inter-service-auth\.ts$|nv-sdk-downloads-routes\.ts$' || true)
if [ -n "$EXTRACT_VIOLATIONS" ]; then
  echo "$EXTRACT_VIOLATIONS"
  echo ""
  echo "  ✗ Local extractApiKey() found. Import extractSdkApiKey from"
  echo "    src/middleware/jrx-sdk-auth-header.ts instead."
  EXIT=1
fi

# 4. Manual Bearer parsing outside the canonical helper is the most common
#    way SDK routes silently desync from the X-API-Key contract. Forbid
#    naive `.replace('Bearer ', …)` and `.slice(7)` on the Authorization
#    header in src/ outside the whitelisted files (canonical helper, the
#    inter-service east-west helper, and the JWT auth middleware which
#    legitimately strips Bearer for first-party JWTs).
# Whitelist files where Bearer slicing is legitimately stripping a JWT
# (not an SDK API key) — these paths are NOT subject to NV-AUTH-HEADER-001
# because they don't authenticate SDK callers:
#   • nv-sdk-auth-header.ts          — the canonical SDK helper itself
#   • nv-inter-service-auth.ts       — east-west, different concern
#   • nv-auth.ts / nv-auth-middleware.ts / jwt-auth.ts — first-party JWT auth
#   • nv-sdk-gateway.ts              — JWT-bypass path explicitly skips nyv_*
#                                       SDK keys (only handles JWTs)
#   • nv-user-profile-routes.ts      — re-hashes the current session JWT
#                                       AFTER requireAuth has already validated
#                                       it; never an SDK key path
JWT_AUTH_WHITELIST='./jrx-sdk-auth-header\.ts$|nv-inter-service-auth\.ts$|nv-auth\.ts$|nv-auth-middleware\.ts$|jwt-auth\.ts$|nv-sdk-gateway\.ts$|nv-user-profile-routes\.ts$'
BEARER_PATTERN="\.replace\(['\"]Bearer\s|\.slice\(\s*7\s*\)"
BEARER_VIOLATIONS=$(rg -lP "$BEARER_PATTERN" src/ 2>/dev/null | grep -vE "$JWT_AUTH_WHITELIST" || true)
if [ -n "$BEARER_VIOLATIONS" ]; then
  echo "$BEARER_VIOLATIONS" | sed 's/^/  ✗ /'
  echo ""
  echo "  ✗ Manual Bearer-token parsing detected. SDK routes must use"
  echo "    extractSdkApiKey() from src/middleware/jrx-sdk-auth-header.ts so"
  echo "    they accept BOTH X-API-Key and Authorization: Bearer. If this"
  echo "    is a JWT-only auth path, add the file to JWT_AUTH_WHITELIST."
  EXIT=1
fi

if [ "$EXIT" -eq 0 ]; then
  echo "  ✓ auth-header discipline OK"
fi

exit "$EXIT"
