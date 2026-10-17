#!/usr/bin/env bash
# NV-NEVER-BREAK-001 — Master regression guardrail (Session-15 v3, 2026-05-11)
#
# Mandate from user: "what you ship now will never be broken again."
# This script asserts every feature shipped this session still has its
# wires intact. Runs in the `npm run guardrail` chain. CI-enforced.
#
# Each check is a static source assertion (no network, no DB) so it runs
# fast and deterministically in CI. Runtime smoke is a separate concern
# (see scripts/jrx-smoke-bash.sh).
#
# Add a new shipped feature? Append a SECTION below following the existing
# pattern — never remove an existing one.

set -euo pipefail
cd "$(dirname "$0")/.."

declare -i FAIL=0
ok()   { printf "  ✓ %s\n" "$1"; }
fail() { printf "  ✗ %s\n" "$1"; FAIL+=1; }
sec()  { printf "\n── %s ──\n" "$1"; }

require_file()    { [[ -f "$1" ]] && ok "exists: $1" || fail "MISSING file: $1"; }
require_grep()    { rg -q "$1" "$2" 2>/dev/null && ok "$3" || fail "$3 (pattern '$1' not in $2)"; }
require_no_grep() { ! rg -q "$1" "$2" 2>/dev/null && ok "$3" || fail "$3 (pattern '$1' found in $2)"; }
# NV-CONTRACT-001: pages import paths via nv() / p() from nv-api-paths.ts — accept those too.
require_api_path() {
  local literal="$1" file="$2" desc="$3"
  local rel="${literal#/api/jrx/}"
  if rg -q "$literal" "$file" 2>/dev/null \
    || rg -q "nv\\(['\"]${rel}" "$file" 2>/dev/null \
    || { rg -q "p\\(['\"][A-Z0-9_]+['\"]\\)" "$file" 2>/dev/null && rg -q "$literal" "client/src/lib/jrx-api-paths.ts" 2>/dev/null; }; then
    ok "$desc"
  else
    fail "$desc (expected '$literal' or nv('$rel') in $file)"
  fi
}

sec "Item A — Postman collection generator (Phase 6)"
require_file "scripts/jrx-build-postman-collection.ts"
require_file "docs/openapi/nyayavigya-v5.openapi.json"

sec "Item B — Ecosystem smoke harness (Phase 4) with NSP/NSPM/NYM filter"
require_file "scripts/jrx-smoke-bash.sh"
require_grep "PLATFORMS_FILTER" "scripts/jrx-smoke-bash.sh" "smoke script honors PLATFORMS_FILTER env"

sec "Item C — Audit-Chain UI (gap #1)"
require_file "client/src/pages/hash-chain-audit.tsx"
require_api_path "/api/jrx/lineage/audit"  "client/src/pages/hash-chain-audit.tsx" "UI calls /api/jrx/lineage/audit"
require_api_path "/api/jrx/lineage/export" "client/src/pages/hash-chain-audit.tsx" "UI calls /api/jrx/lineage/export"
require_grep "router.get\(['\"]\\/lineage\\/audit"  "src/routes/jrx-completions-routes.ts" "backend GET /lineage/audit live"
require_grep "router.post\(['\"]\\/lineage\\/export" "src/routes/jrx-completions-routes.ts" "backend POST /lineage/export live"
require_grep "path=\"/audit-chain\"" "client/src/App.tsx" "/audit-chain route mounted"

sec "Item D — Live Activity Feed (gap #4)"
require_file "src/services/jrx-activity-event-bus.ts"
require_file "src/middleware/jrx-activity-publisher.ts"
require_file "src/routes/jrx-activity-stream-routes.ts"
require_grep "router.get\(['\"]\\/stream"  "src/routes/jrx-activity-stream-routes.ts" "SSE /stream route present"
require_grep "router.get\(['\"]\\/recent"  "src/routes/jrx-activity-stream-routes.ts" "/recent fallback present"
require_grep "router.get\(['\"]\\/health"  "src/routes/jrx-activity-stream-routes.ts" "/health probe present"
require_grep "./jrx-activity-stream-routes"   "src/index.ts" "activity routes wired into index.ts"
require_grep "activityPublisher"           "src/index.ts" "activity publisher middleware wired into index.ts"
require_no_grep "<PhaseCScaffold|from '@/components/PhaseCScaffold'" "client/src/pages/live-activity-feed.tsx" "live-activity-feed.tsx is no longer the PhaseC stub (no JSX/import use)"
require_grep "EventSource"       "client/src/pages/live-activity-feed.tsx" "frontend uses EventSource for SSE"

sec "Item E — SDK Key revocation (gap #3)"
require_file "client/src/pages/sdk-key-management.tsx"
require_file "src/routes/jrx-sdk-keylife-routes.ts"
require_grep "/revoke/" "client/src/pages/sdk-key-management.tsx" "UI calls revoke endpoint"
require_grep "router.post\(['\"]\\/:appId/revoke/:keyId" "src/routes/jrx-sdk-keylife-routes.ts" "backend POST /:appId/revoke/:keyId live"
require_grep "router.post\(['\"]\\/:appId/revoke-all"    "src/routes/jrx-sdk-keylife-routes.ts" "backend POST /:appId/revoke-all live"

sec "Item F — Cost Optimizer wired to live router-stats (gap #5, Session-15 v4)"
require_file "client/src/pages/cost-optimizer.tsx"
require_grep "/api/jrx/cost/overview|COST_OVERVIEW|p\\('COST_OVERVIEW'\\)" "client/src/pages/cost-optimizer.tsx" "cost-optimizer fetches live cost/overview aggregator"
require_grep "useQuery" "client/src/pages/cost-optimizer.tsx" "cost-optimizer uses react-query (no hardcoded zeros)"
require_no_grep "tier1Usage: 0" "client/src/pages/cost-optimizer.tsx" "cost-optimizer no longer hardcodes zeros"
require_grep "router.get\(['\"]\\/router-stats" "src/routes/jrx-router-stats-routes.ts" "backend GET /router-stats live"
require_grep "/api/jrx/observability'.*nvRouterStatsRouter" "src/index.ts" "router-stats mounted under /api/jrx/observability"

sec "Item G — Bulk Document Upload UX (gap #7, Session-15 v4)"
require_file "client/src/pages/bulk-doc-upload.tsx"
require_grep "/api/nv5/doc-ai/jobs" "client/src/pages/bulk-doc-upload.tsx" "bulk upload posts to /api/nv5/doc-ai/jobs"
require_grep "X-API-Key" "client/src/pages/bulk-doc-upload.tsx" "bulk upload sends X-API-Key (NV-AUTH-HEADER-001)"
require_grep "router.post\(['\"]\\/jobs" "src/routes/nv5/doc-ai/convert-routes.ts" "backend POST /jobs live"
require_grep "router.get\(['\"]\\/jobs/:id" "src/routes/nv5/doc-ai/convert-routes.ts" "backend GET /jobs/:id live"
require_grep "router.get\(['\"]\\/jobs/:id/result" "src/routes/nv5/doc-ai/convert-routes.ts" "backend GET /jobs/:id/result live"
require_grep "path=\"/bulk-doc-upload\"" "client/src/App.tsx" "/bulk-doc-upload route mounted in App.tsx"

sec "Item H — Phase 6 integration guides (NSP-Web / NSP-Mobile / NYM, Session-15 v4)"
require_file "docs/integration-guides/nsp-web.md"
require_file "docs/integration-guides/nsp-mobile.md"
require_file "docs/integration-guides/nym.md"
require_grep "X-API-Key" "docs/integration-guides/nsp-web.md" "NSP-Web guide documents canonical X-API-Key header"
require_grep "X-API-Key" "docs/integration-guides/nsp-mobile.md" "NSP-Mobile guide documents canonical X-API-Key header"
require_grep "X-API-Key" "docs/integration-guides/nym.md" "NYM guide documents canonical X-API-Key header"
require_grep "NV-SDK-UNIFIED-001" "docs/integration-guides/nsp-web.md" "NSP-Web guide cites unified-SDK mandate"

sec "Item I — RBAC Console + Agent Matrix (gaps #8 / #9, Session-15 v4 verify-and-lock)"
require_file "client/src/pages/rbac-console.tsx"
require_file "client/src/pages/superadmin-agent-matrix.tsx"
require_api_path "/api/jrx/rbac/roles"     "client/src/pages/rbac-console.tsx" "rbac-console fetches /api/jrx/rbac/roles"
require_api_path "/api/jrx/rbac/audit-log" "client/src/pages/rbac-console.tsx" "rbac-console fetches /api/jrx/rbac/audit-log"
require_grep "/api/jrx/agents"          "client/src/pages/superadmin-agent-matrix.tsx" "agent-matrix fetches /api/jrx/agents"
require_grep "path=\"/rbac-console\""  "client/src/App.tsx" "/rbac-console route mounted"

sec "Unified-SDK mandate (NSP-Web / NSP-Mobile / NYM and beyond)"
# No per-platform branching may exist in route mounts — single NYV API, key-differentiated.
if rg -n "app\\.use\\(['\"]/api/(nv-)?(nsp|nspm|nym|nsi|nsa|nsm|jrx)" src/index.ts 2>/dev/null | rg -v "^\\s*//"; then
  fail "per-platform route mount detected in src/index.ts (must be unified under /api/nv*)"
else
  ok "no per-platform route mounts in src/index.ts (unified NYV API enforced)"
fi

sec "Item J — Console→endpoint contracts (console-cpo-audit §3.2 — 12 endpoints, locked)"
# Gateway document aliases (/draft /analyze /summarize → 308 → /documents/{...})
require_grep "router.post\(['\"]\\/draft"     "src/routes/jrx-sdk-gateway-routes.ts" "gateway /draft alias live"
require_grep "router.post\(['\"]\\/analyze"   "src/routes/jrx-sdk-gateway-routes.ts" "gateway /analyze alias live"
require_grep "router.post\(['\"]\\/summarize" "src/routes/jrx-sdk-gateway-routes.ts" "gateway /summarize alias live"
# Orchestration status (auth-gated → 401 not 404)
require_grep "router.get\(['\"]\\/status"     "src/routes/jrx-orchestration-routes.ts" "orchestration /status route live"
# Drift namespace root liveness
require_grep "driftMonitorRouter.get\(['\"]\\/['\"]" "src/routes/jrx-drift-monitor-routes.ts" "drift namespace root live"
# nv5 sub-router /health probes (7 namespaces)
require_grep "router.get\(['\"]\\/health"  "src/routes/nv5/multimodal/3d-immersive-routes.ts"   "nv5 multimodal /health live"
require_grep "router.get\(['\"]\\/health"  "src/routes/nv5/voice/enhanced-routes.ts"            "nv5 voice /health live"
require_grep "router.get\(['\"]\\/health"  "src/routes/nv5/workflows/autonomous-routes.ts"      "nv5 workflows /health live"
require_grep "router.get\(['\"]\\/health"  "src/routes/nv5/doc-ai/convert-routes.ts"            "nv5 doc-ai /health live"
require_grep "router.get\(['\"]\\/health"  "src/routes/nv5/legal-pipeline/index.ts"             "nv5 legal-pipeline /health live"
require_grep "router.get\(['\"]\\/health"  "src/routes/nv5/compliance/index.ts"                 "nv5 compliance /health live"
require_grep "router.get\(['\"]\\/health"  "src/routes/nv5/gov/index.ts"                        "nv5 gov /health live"
# nv5 workflows root index list
require_grep "router.get\(['\"]\\/['\"]"   "src/routes/nv5/workflows/index.ts"                  "nv5 workflows root list live"

sec "Item K — Customer-facing Model Catalog hygiene (:free OpenRouter backups hidden)"
require_grep "isFreeTierBackup"            "src/routes/jrx-model-registry-routes.ts" "model registry filters :free backups from default list"
require_grep "includeFreeTier"             "src/routes/jrx-model-registry-routes.ts" "internal callers can opt in via ?includeFreeTier=true"

if (( FAIL > 0 )); then
  printf "\n✗ NV-NEVER-BREAK-001: %d violation(s).\n" "$FAIL" >&2
  exit 1
fi
printf "\n✓ NV-NEVER-BREAK-001: all shipped features intact.\n"
