#!/usr/bin/env bash
# nv-session-preflight.sh — MANDATORY session-start brief.
# Per guardrails.md § 6, every session runs this before plan/code.
# Prints a consolidated snapshot so you don't repeat shallow audits.

set -u
cd "$(dirname "$0")/.."

bold() { printf "\033[1m%s\033[0m\n" "$*"; }
sep()  { printf -- "----------------------------------------------------------------------\n"; }

bold "╔══════════════════════════════════════════════════════════════════════╗"
bold "║   NYAYAVIGYA PLATFORM — SESSION PREFLIGHT BRIEF                      ║"
bold "║   Run before any plan, code change, or 'is feature X wired' verdict  ║"
bold "╚══════════════════════════════════════════════════════════════════════╝"
echo "Date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Workspace: $(pwd)"
echo

bold "[1/8] Mandatory pre-session reads — file presence check"
sep
for f in replit.md guardrails.md FEATURES-REGISTRY.md CHANGELOG.md projecttracker.md Project-Tracker.md \
         docs/canonical/00-README.md docs/canonical/04-sdk-and-api-canonical-2026-05-07.md \
         docs/canonical/04c-sdk-troubleshooting-2026-05-11.md \
         docs/audit/feature-inventory-2026-05-11.md \
         docs/audit/feature-matrix-and-status-2026-05-11.md \
         docs/audit/jrx-orphan-disposition.md \
         docs/audit/jrx-orphan-budget.json; do
  if [ -f "$f" ]; then
    printf "  OK  %s (%s lines)\n" "$f" "$(wc -l < "$f")"
  else
    printf "  ❌  MISSING %s\n" "$f"
  fi
done
echo

bold "[2/8] Headline numbers"
sep
ROUTE_MOUNTS=$(rg -c "^app\.use\(['\"]/api/nv" src/index.ts 2>/dev/null || echo "?")
ROUTE_FILES=$(ls src/routes/*.ts 2>/dev/null | wc -l)
PAGE_FILES=$(find client/src/pages -name '*.tsx' 2>/dev/null | wc -l)
APP_ROUTES=$(rg -c '<Route path=' client/src/App.tsx 2>/dev/null || echo "?")
AGENT_REGS=$(ls config/agent-registries/Nyayavigya-Legal-registry-*.json 2>/dev/null | wc -l)
CONFIG_FILES=$(ls src/config/*.ts 2>/dev/null | wc -l)
SERVICES=$(find src/services -maxdepth 1 -type d 2>/dev/null | tail -n +2 | wc -l)
PACKAGES=$(find src/packages -maxdepth 1 -type d 2>/dev/null | tail -n +2 | wc -l)
TOP_PKGS=$(find packages -maxdepth 1 -type d 2>/dev/null | tail -n +2 | wc -l)
SCRIPTS=$(ls scripts/*.{ts,sh} 2>/dev/null | wc -l)
printf "  Gateway route mounts: %s\n" "$ROUTE_MOUNTS"
printf "  Route files (src/routes/*.ts): %s\n" "$ROUTE_FILES"
printf "  Console page files (.tsx): %s\n" "$PAGE_FILES"
printf "  Console <Route> entries (App.tsx): %s\n" "$APP_ROUTES"
printf "  Agent registries (jurisdictions): %s\n" "$AGENT_REGS"
printf "  src/config files: %s\n" "$CONFIG_FILES"
printf "  src/services subdirs: %s\n" "$SERVICES"
printf "  src/packages subdirs: %s\n" "$PACKAGES"
printf "  top-level publishable packages: %s\n" "$TOP_PKGS"
printf "  scripts: %s\n" "$SCRIPTS"
echo

bold "[3/8] DB sanity (count only — NO data dumped)"
sep
if [ -n "${NYV_DATABASE_URL:-}" ]; then
  TBL=$(psql "$NYV_DATABASE_URL" -tAc "SELECT COUNT(*) FROM pg_tables WHERE schemaname IN ('public','nv_schema')" 2>/dev/null || echo "?")
  AGENTS=$(psql "$NYV_DATABASE_URL" -tAc "SELECT COUNT(*) FROM nv_agents" 2>/dev/null || echo "?")
  PROV_ACTIVE=$(psql "$NYV_DATABASE_URL" -tAc "SELECT COUNT(*) FROM nv_llm_providers WHERE is_active=true" 2>/dev/null || echo "?")
  MODELS_ACTIVE=$(psql "$NYV_DATABASE_URL" -tAc "SELECT COUNT(*) FROM nv_model_catalog WHERE is_active=true" 2>/dev/null || echo "?")
  printf "  Tables (public + nv_schema): %s\n" "$TBL"
  printf "  nv_agents rows: %s\n" "$AGENTS"
  printf "  nv_llm_providers active: %s\n" "$PROV_ACTIVE"
  printf "  nv_model_catalog active: %s\n" "$MODELS_ACTIVE"
else
  echo "  ⚠ NYV_DATABASE_URL not set — skipping"
fi
echo

bold "[4/8] Wiring audit summary"
sep
if [ -f docs/audit/jrx-wiring-audit.json ]; then
  python3 -c "
import json
with open('docs/audit/jrx-wiring-audit.json') as f:
    d = json.load(f)
s = d.get('summary', d)
for k in ['totalFiles','wired','usedInternal','orphan','effectiveOrphan']:
    if k in s: print(f'  {k}: {s[k]}')
" 2>/dev/null || echo "  (couldn't parse summary — re-run: npm run audit:wiring)"
else
  echo "  ⚠ no wiring-audit.json — run: npm run audit:wiring"
fi
[ -f docs/audit/jrx-orphan-budget.json ] && echo "  budget: $(cat docs/audit/jrx-orphan-budget.json)"
echo

bold "[5/8] Hard architectural guardrails (NV-* — CI-enforced)"
sep
echo "  NV-ARCH-001         no-bypass safety ring"
echo "  NV-LLM-001          single-router rule (7-file whitelist)"
echo "  NV-NAMING-001       pre-flight grep before new src/ files"
echo "  NV-WIRING-001       service NOT done until imported by wired consumer"
echo "  NV-MESH-001         factory ≠ Queen-scheduled until INTENT + analyzePrompt (+ tool-bridge)"
echo "  NV-DOC-001          markdown bucket discipline"
echo "  NV-SECRETS-001      one canonical name per secret"
echo "  NV-CONTRACT-001     pre-flight grep for method/route/schema names"
echo "  NV-OWNERSHIP-001    test failures reproduced + traced + owned"
echo "  NV-AUTH-HEADER-001  X-API-Key only (Bearer fallback); X-NV-API-Key east-west"
echo "  NV-DB-SCRIPT-001    scripts use makePgSql() from scripts/_pg-pool.ts"
echo "  NV-API-CONTRACT-001 frozen v5 surface; additions OK, removals/method fail CI"
echo "  NV-WIRING-BUDGET-001 effective orphan budget"
echo "  NV-AGENT-REGISTRY-FRESH-001 per-jurisdiction edit + flat-registry rebuild"
echo "  Run all: npm run guardrail"
echo

bold "[6/8] Recent CHANGELOG entries (last 30 lines of [Unreleased])"
sep
awk '/^## \[Unreleased\]/{flag=1; lines=0} flag && lines<30 {print; lines++}' CHANGELOG.md 2>/dev/null | head -30
echo

bold "[7/8] Gateway + console workflows — last 5 lines each"
sep
GLOG=$(ls -t /tmp/logs/NYV*Gateway*.log 2>/dev/null | head -1)
CLOG=$(ls -t /tmp/logs/NYV*Console*.log 2>/dev/null | head -1)
[ -n "$GLOG" ] && echo "  GATEWAY: $GLOG" && tail -5 "$GLOG" 2>/dev/null | sed 's/^/    /'
[ -n "$CLOG" ] && echo "  CONSOLE: $CLOG" && tail -5 "$CLOG" 2>/dev/null | sed 's/^/    /'
echo

bold "[8/8] REMINDERS"
sep
echo "  → Read guardrails.md (THE 7 mandatory pre-session docs) BEFORE plan/code."
echo "  → Triple-pass audit (source tree + DB/config/registries + wiring/docs)"
echo "    BEFORE any 'feature X is missing/not-wired' verdict."
echo "  → Cross-check feature names against FEATURES-REGISTRY.md before building."
echo "  → Per-family pre-write reads in guardrails.md § 3."
echo
bold "Preflight complete. Proceed only after reading the 7 mandatory docs above."
