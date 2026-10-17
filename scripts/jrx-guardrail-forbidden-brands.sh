#!/usr/bin/env bash
# JRX-FORBIDDEN-BRAND-001 — fail CI if Nyayavigya/Nyayasiddhi traces appear outside allowlisted paths.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ALLOW_GLOBS=(
  --glob '!node_modules/**'
  --glob '!**/node_modules/**'
  --glob '!dist/**'
  --glob '!client/dist/**'
  --glob '!archive/**'
  --glob '!patches/**'
  --glob '!documents/working/archive/**'
  --glob '!UPSTREAM-NYV-SHA.txt'
  --glob '!**/JUREXIO-FORK-LINEAGE.md'
  --glob '!**/JRX-NAMING-AND-BOUNDARY-RFC.md'
  --glob '!**/JRX-OPERATING-MODEL.md'
  --glob '!UPSTREAM-NYV-SHA.txt'
  --glob '!**/JRX-OPERATING-MODEL.md'
  --glob '!**/JRX-UPSTREAM-SYNC.md'
  --glob '!**/JRX-SEARCH-US-CORPUS-PLAN.md'
  --glob '!**/JRX-DATA-RESIDENCY.md'
  --glob '!**/JRX-SOC2-TENANT-BOUNDARY.md'
  --glob '!**/JUREXIO-ENTERPRISE-SDK.md'
  --glob '!**/JRX-AWS-INFRA-OPTIONS-AND-RUNBOOK.md'
  --glob '!**/JRX-LEGACY-NYV-COMPOSE.md'
  --glob '!**/JRX-SEARCH-US-CORPUS-PLAN.md'
  --glob '!scripts/jurexio-export-bootstrap.sh'
  --glob '!scripts/jrx-phase2-rename.py'
  --glob '!scripts/jrx-guardrail-forbidden-brands.sh'
)

PATTERN='Nyayavigya|Nyayasiddhi|nyayasiddhi\.online|nysdev|/opt/Nyayavigya'

SCAN_PATHS=(src client/src packages shared .github documents/working)

HITS="$(rg -n "$PATTERN" "${ALLOW_GLOBS[@]}" "${SCAN_PATHS[@]}" 2>/dev/null | head -200 || true)"
if [[ -n "$HITS" ]]; then
  echo "JRX forbidden-brand guardrail FAILED (first 200 hits):"
  echo "$HITS"
  exit 1
fi

echo "JRX forbidden-brand guardrail PASS"
