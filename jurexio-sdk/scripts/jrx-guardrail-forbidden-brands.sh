#!/usr/bin/env bash
# JRX-FORBIDDEN-BRAND-002 — zero legacy fork tokens in active Jurexio tree (see PATTERN).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

ALLOWLIST="${ROOT}/scripts/jrx-guardrail-nyv-allowlist.txt"
PATTERN="$(tr -d '\n' < "${ROOT}/scripts/lib/forbidden-brand-nyv.pattern")"

ALLOW_GLOBS=(
  --glob '!node_modules/**'
  --glob '!**/node_modules/**'
  --glob '!dist/**'
  --glob '!client/dist/**'
  --glob '!archive/**'
  --glob '!patches/**'
  --glob '!documents/working/archive/**'
  --glob '!CHANGELOG.md'
  --glob '!Project-Tracker.md'
  --glob '!scripts/jrx-guardrail-forbidden-brands.sh'
  --glob '!scripts/jrx-zero-nyv-scrub.py'
  --glob '!scripts/jrx-phase2-rename.py'
  --glob '!scripts/jrx-phase2-brand-scrub.py'
)

SCAN_PATHS=(
  src
  client/src
  packages
  shared
  documents/working
  scripts/jrx-*
)

RG_ARGS=(-n -P "$PATTERN" "${ALLOW_GLOBS[@]}" "${SCAN_PATHS[@]}")

if [[ -f "$ALLOWLIST" ]] && [[ -s "$ALLOWLIST" ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%%#*}"
    line="$(echo "$line" | xargs)"
    [[ -z "$line" ]] && continue
    RG_ARGS+=(--glob "!${line}")
  done < "$ALLOWLIST"
fi

HITS="$(rg "${RG_ARGS[@]}" 2>/dev/null | head -200 || true)"
if [[ -n "$HITS" ]]; then
  echo "JRX forbidden-brand guardrail FAILED (first 200 hits):"
  echo "$HITS"
  exit 1
fi

echo "JRX forbidden-brand guardrail PASS"
