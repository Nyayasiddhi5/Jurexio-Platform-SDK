#!/usr/bin/env bash
#
# nv-client-type-check.sh — CI gate for the React console (`client/**`).
#
# WHY: On 2026-06-03 a missing `import { useState }` in command-centre.tsx
# (the super_admin landing page) shipped to production and crashed the whole
# console. It escaped CI because the root `tsconfig.json` `include` is
# `["src/**/*"]` — `client/**` was NEVER type-checked. esbuild/vite do not error
# on undefined identifiers, so the bug was invisible until runtime.
#
# WHAT: Type-checks `client/**` via `tsc -p client --noEmit`. The console carries
# a large pre-existing type-soundness backlog (see client/.tsc-baseline.txt), so
# a strict all-or-nothing gate is not yet viable. Instead this is a BASELINE-DIFF
# gate: it fails ONLY on errors that are NOT already in the baseline — i.e. errors
# newly introduced by the current change. This catches missing-import / undefined-
# identifier regressions (TS2304/TS2552/TS2307/TS2451 …) in any edited file while
# letting the backlog be burned down over time.
#
# To refresh the baseline after legitimately reducing errors:
#   npm run type-check:client:baseline
#
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BASELINE="client/.tsc-baseline.txt"
TMP_RAW="$(mktemp)"
TMP_NORM="$(mktemp)"
trap 'rm -f "$TMP_RAW" "$TMP_NORM"' EXIT

echo "▶ Type-checking client/** (tsc -p client --noEmit) …"
npx tsc -p client --noEmit > "$TMP_RAW" 2>&1 || true

# Normalize: keep only "error TSxxxx" lines, strip (line,col) so the diff is
# resilient to harmless line shifts; dedupe.
grep -E "error TS[0-9]+" "$TMP_RAW" | sed -E 's/\(([0-9]+),([0-9]+)\)//' | sort -u > "$TMP_NORM"

if [[ ! -f "$BASELINE" ]]; then
  echo "✗ Missing baseline $BASELINE — run: npm run type-check:client:baseline" >&2
  exit 1
fi

# New = signatures present now but absent from the baseline.
NEW="$(comm -23 "$TMP_NORM" "$BASELINE")"

if [[ -n "$NEW" ]]; then
  echo ""
  echo "✗ NV-CLIENT-TYPES: new client type errors introduced (not in baseline):" >&2
  echo "$NEW" >&2
  echo "" >&2
  echo "Fix the error(s) above. If you intentionally reduced the backlog, refresh" >&2
  echo "the baseline with: npm run type-check:client:baseline" >&2
  exit 1
fi

TOTAL="$(wc -l < "$TMP_NORM" | tr -d ' ')"
echo "✓ NV-CLIENT-TYPES: no NEW client type errors (baseline backlog: ${TOTAL} signatures)."
exit 0
