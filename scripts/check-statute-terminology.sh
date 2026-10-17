#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Jurexio Platform 3.1.2 — Legal Terminology Linting Script
# JRX-LINT-TERMINOLOGY-001
# T009 — Sprint 3
#
# Purpose: Detect bare IPC/CrPC references that should be replaced with
#          BNS 2023 / BNSS 2023 / BSA 2023 in route/service/type files.
#
# Correct usage:
#   IPC 1860      → BNS 2023 (Bharatiya Nyaya Sanhita)
#   CrPC 1973     → BNSS 2023 (Bharatiya Nagarik Suraksha Sanhita)
#   Evidence Act  → BSA 2023 (Bharatiya Sakshya Adhiniyam)
#
# The following are ALWAYS ALLOWED (historical reference context):
#   "IPC 1860"     (explicitly dated — historical reference)
#   "CrPC 1973"    (explicitly dated — historical reference)
#   "pre-July 2024" + IPC/CrPC  (historical context)
#   "historical" + IPC/CrPC
#   "former" + IPC/CrPC
#
# The following are NOT ALLOWED (bare current-law references):
#   "section X of IPC"  → should be "section X of BNS 2023"
#   "under the IPC"     → should be "under BNS 2023"
#   "CrPC provisions"   → should be "BNSS 2023 provisions"
#   SOC 2 Certified     → should be "SOC 2 Ready for Audit"
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCAN_DIRS=(
  "$REPO_ROOT/src/routes"
  "$REPO_ROOT/src/services"
  "$REPO_ROOT/src/middleware"
  "$REPO_ROOT/client/src/pages"
  "$REPO_ROOT/client/src/components"
  "$REPO_ROOT/packages"
)

RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

ERRORS=0
WARNINGS=0

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  Jurexio Platform 3.1.2 — Legal Terminology Linter"
echo "  T009 | Sprint 3 | Checking IPC/CrPC/Evidence Act references"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# ─── Helper: scan a directory for a pattern ──────────────────────────────────
scan() {
  local pattern="$1"
  local description="$2"
  local severity="${3:-ERROR}"
  local found=0

  for dir in "${SCAN_DIRS[@]}"; do
    if [ -d "$dir" ]; then
      while IFS= read -r line; do
        if [ -n "$line" ]; then
          found=1
          if [ "$severity" = "ERROR" ]; then
            echo -e "  ${RED}[ERROR]${NC} $description"
          else
            echo -e "  ${YELLOW}[WARN]${NC}  $description"
          fi
          echo -e "  ${BLUE}  →${NC} $line"
          echo ""
        fi
      done < <(grep -rn --include="*.ts" --include="*.tsx" \
        --exclude-dir="node_modules" --exclude-dir="dist" --exclude-dir=".git" \
        -E "$pattern" "$dir" 2>/dev/null \
        | grep -v "IPC 1860" \
        | grep -v "CrPC 1973" \
        | grep -v "pre-July 2024" \
        | grep -v "historical" \
        | grep -v "former" \
        | grep -v "check-statute-terminology" \
        | grep -v "\.sh:" \
        || true)
    fi
  done

  if [ $found -gt 0 ]; then
    if [ "$severity" = "ERROR" ]; then
      ERRORS=$((ERRORS + found))
    else
      WARNINGS=$((WARNINGS + found))
    fi
  fi
}

# ─── Rule 1: Bare "IPC" references (without year qualifier) ──────────────────
echo -e "${BLUE}[RULE 1]${NC} Checking for bare 'IPC' without year qualifier or historical context…"
scan \
  "(under the IPC|of the IPC|section [0-9]+[A-Z]? IPC|IPC section|IPC provisions|IPC offence|IPC charge|IPC crime|,\s*IPC\b)" \
  "Bare 'IPC' reference (replace with BNS 2023 for post-July 2024 law)" \
  "ERROR"

# ─── Rule 2: Bare "CrPC" references ─────────────────────────────────────────
echo -e "${BLUE}[RULE 2]${NC} Checking for bare 'CrPC' without year qualifier or historical context…"
scan \
  "(under the CrPC|of the CrPC|CrPC section|CrPC provisions|CrPC procedure|CrPC application)" \
  "Bare 'CrPC' reference (replace with BNSS 2023 for post-July 2024 law)" \
  "ERROR"

# ─── Rule 3: Evidence Act references without BSA substitution ────────────────
echo -e "${BLUE}[RULE 3]${NC} Checking for 'Evidence Act' without BSA 2023 context…"
scan \
  "(Indian Evidence Act|under the Evidence Act|Evidence Act section|Evidence Act provision)" \
  "Bare 'Evidence Act' reference (replace with BSA 2023 — Bharatiya Sakshya Adhiniyam)" \
  "WARNING"

# ─── Rule 4: SOC 2 Certified (must be "SOC 2 Ready for Audit") ───────────────
echo -e "${BLUE}[RULE 4]${NC} Checking for 'SOC 2 Certified' (must be 'SOC 2 Ready for Audit')…"
scan \
  "SOC 2 Certified" \
  "Use 'SOC 2 Ready for Audit' — not 'SOC 2 Certified' (certification not yet awarded)" \
  "ERROR"

# ─── Rule 5: Institutional CTA language ──────────────────────────────────────
echo -e "${BLUE}[RULE 5]${NC} Checking for disallowed institutional CTA language…"
scan \
  "(Sign Up|Buy Now|Purchase Now|Subscribe Now)" \
  "Institutional CTA must be 'Request Institutional Access' or 'Request Institutional Proposal'" \
  "WARNING"

# ─── Summary ─────────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  LINTING SUMMARY"
echo "═══════════════════════════════════════════════════════════════"
if [ $ERRORS -gt 0 ]; then
  echo -e "  ${RED}✗ $ERRORS error(s) found — must fix before release${NC}"
fi
if [ $WARNINGS -gt 0 ]; then
  echo -e "  ${YELLOW}⚠  $WARNINGS warning(s) found — review before release${NC}"
fi
if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
  echo -e "  ${GREEN}✓ All terminology checks passed — no violations found${NC}"
fi
echo ""
echo "  Statute reference guide:"
echo "  IPC 1860     → BNS 2023 (Bharatiya Nyaya Sanhita)"
echo "  CrPC 1973    → BNSS 2023 (Bharatiya Nagarik Suraksha Sanhita)"
echo "  Evidence Act → BSA 2023 (Bharatiya Sakshya Adhiniyam)"
echo "  SOC 2 Certified → SOC 2 Ready for Audit"
echo "═══════════════════════════════════════════════════════════════"
echo ""

if [ $ERRORS -gt 0 ]; then
  exit 1
fi
exit 0
