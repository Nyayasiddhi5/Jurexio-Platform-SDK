#!/usr/bin/env bash
# dashboard-route-lint.sh — sidebar↔route↔page triangulation lint
#
# Introduced 2026-05-06 (T002, Phase B finish).
#
# Verifies:
#   1. Every JrxConsoleSidebar.tsx path has a matching App.tsx <Route path=...>
#      (querystrings are normalized away, e.g. /chat?tab=legal -> /chat)
#   2. Optionally (strict mode), every App.tsx Route has either a sidebar
#      entry OR is on ALLOW_ORPHAN.
#
# Exit 0 = clean. Exit 1 = violations. Run from repo root.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SIDEBAR="$ROOT/client/src/components/JrxConsoleSidebar.tsx"
APPTSX="$ROOT/client/src/App.tsx"

# Routes we accept as orphan (no sidebar entry). Trim this list as the
# 73 orphans are systematically deleted or re-surfaced in subsequent
# Phase A passes.
ALLOW_ORPHAN=(
  # ── Framework / system ──
  /
  /home
  /login
  /admin
  /command-centre
  # ── Admin-console alias (kept; route maps to <CommandCentre>) ──
  /admin-console
  # ── Deferred dashboards (next-session cleanup; see replit.md) ──
  /enterprise-dashboard
  /realtime-dashboard
  # ── Architectural / super-admin only (no sidebar by design) ──
  /digital-twin
  /digital-twin-creator
  /architect
  /institutional
  /academy
  /ministry
  /lrm-dashboard
  /superagent
  /superadmin/overview
  /dashboard
  /governance
  /workspace
  "/workspace/:id"
  /global-chat
  # ── User-profile + org-admin variants (consolidated under sidebar Team & RBAC) ──
  /org-admin
  /org-admin-dashboard
  /user-profile
  /user/profile
  /platform-config
  /org-platform-settings
  # ── Module sub-pages (parent in sidebar; sub-routes are deep-links) ──
  /clawdbot-console
  /openbot-studio
  /automateai-builder
  /automation
  # ── Agent ops sub-pages (parent /agent-registry in sidebar) ──
  /agents
  /agent-activity
  /agent-flows
  /agent-live-testing
  /agent-scorecard
  /agent-testing
  /create-agent
  /adversarial-testing
  # ── Orchestration sub-pages (parent /orchestration in sidebar) ──
  /orchestration/a2a
  /orchestration/bmad
  /orchestration/cam
  /orchestration/memory
  /orchestration/policies
  /orchestration/router-decisions
  /orchestration-dashboard
  "/orchestration/lineage/:requestId"
  # ── Intelligence sub-pages (parent /intelligence/dashboard in sidebar) ──
  /intelligence
  /legal-ner
  /ner-explorer
  /multimodal
  /identity-extraction
  /forensics
  # ── Compliance sub-pages (parent /superadmin/compliance in sidebar) ──
  /compliance/eu-ai-act
  /enforcement
  /hash-chain
  /decision-cards
  /model-drift
  # ── SDK / testing sub-pages (parent /sdk-hub etc. in sidebar) ──
  /sdk-onboarding
  /sdk-playground-v2
  /client-sdk-playground
  /api-testing
  /feature-test
  /sdlc
  /skills
  /skills-marketplace
  /testing/llm-judge
  /testing/scorecard
  /test/p1-quality
  /p1-ai-quality
  # ── Misc admin ──
  /billing/ledger
  /content-studio
  /cost-optimization
)

is_allowed() {
  local r="$1"
  for allowed in "${ALLOW_ORPHAN[@]}"; do
    [[ "$r" == "$allowed" ]] && return 0
  done
  return 1
}

sidebar_paths=$(rg -o "path:\s*['\"]([^'\"]+)['\"]" "$SIDEBAR" -r '$1' | sed 's/[?].*$//' | sort -u)
route_paths=$(rg -o "Route path=\"([^\"]+)\"" "$APPTSX" -r '$1' | sort -u)

violations=0

# 1. sidebar paths missing routes
echo "─── Broken sidebar links (path with no Route) ───"
while IFS= read -r p; do
  if ! grep -qx "$p" <<< "$route_paths"; then
    echo "  ✗ $p"
    violations=$((violations + 1))
  fi
done <<< "$sidebar_paths"

# 2. orphan routes not on allow list (strict only)
STRICT="${NV_ROUTE_LINT_STRICT:-0}"
if [[ "$STRICT" == "1" ]]; then
  echo "─── Orphan routes (Route with no sidebar entry, not on allow list) ───"
  while IFS= read -r p; do
    if ! grep -qx "$p" <<< "$sidebar_paths"; then
      if ! is_allowed "$p"; then
        echo "  ✗ $p"
        violations=$((violations + 1))
      fi
    fi
  done <<< "$route_paths"
else
  echo "─── Orphan routes check skipped (set NV_ROUTE_LINT_STRICT=1 to enforce) ───"
fi

echo ""
if [[ $violations -eq 0 ]]; then
  echo "✓ dashboard-route-lint clean (sidebar=$(echo "$sidebar_paths" | wc -l), routes=$(echo "$route_paths" | wc -l), allow_orphan=${#ALLOW_ORPHAN[@]})"
  exit 0
else
  echo "✗ $violations violation(s). Either add the path to JrxConsoleSidebar.tsx, add to ALLOW_ORPHAN above with justification, or delete the route."
  exit 1
fi
