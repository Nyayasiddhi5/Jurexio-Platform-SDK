#!/usr/bin/env bash
#
# nv-server-type-check.sh — baseline-diff type gate for the server (`src/**`).
#
# WHY THIS EXISTS
# ---------------
# `npm run guardrail` begins with `npm run type-check`, which is a strict
# `tsc --noEmit`. The server carried a 39-error backlog, so that first step ALWAYS
# failed — and because the chain is `&&`-joined, the 16 downstream guardrails
# (api-contract, schema-drift, no-placeholder, intent-mesh, cascade-ids,
# never-break, …) NEVER RAN. The type backlog was not merely untidy; it was
# silently disabling every other guarantee in the chain.
#
# A strict gate cannot be turned on until the backlog is zero, and a backlog that
# blocks all other gates is worse than one that is tracked. So this mirrors the
# proven `nv-client-type-check.sh` pattern: fail only on type errors NOT already in
# the baseline, i.e. errors introduced by the current change.
#
# THE RATCHET
# -----------
# Baseline-diff alone lets the count sit still forever. This gate also fails when
# the total count RISES above the recorded ceiling, even if every signature is
# individually known — that catches the same error appearing in three new places.
# The ceiling only ever moves down: refreshing writes the current (lower) count.
#
# Refresh after legitimately reducing errors:
#   npm run type-check:server:baseline
#
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# `--refresh` records the current state as the new baseline + ceiling.
MODE_REFRESH=0
[[ "${1:-}" == "--refresh" ]] && MODE_REFRESH=1

BASELINE=".tsc-server-baseline.txt"
CEILING_FILE=".tsc-server-ceiling.txt"
TMP_RAW="$(mktemp)"
TMP_NORM="$(mktemp)"
trap 'rm -f "$TMP_RAW" "$TMP_NORM"' EXIT

echo "▶ Type-checking src/** (tsc --noEmit) …"
npx tsc --noEmit > "$TMP_RAW" 2>&1 || true

# Normalise: keep only "error TSxxxx" lines and strip (line,col) so the diff is
# resilient to harmless line shifts; dedupe to signatures.
grep -E "error TS[0-9]+" "$TMP_RAW" | sed -E 's/\(([0-9]+),([0-9]+)\)//' | sort -u > "$TMP_NORM"

RAW_COUNT="$(grep -cE "error TS[0-9]+" "$TMP_RAW" || true)"
SIG_COUNT="$(wc -l < "$TMP_NORM" | tr -d ' ')"

if [[ "$MODE_REFRESH" == "1" ]]; then
  cp "$TMP_NORM" "$BASELINE"
  echo "$RAW_COUNT" > "$CEILING_FILE"
  echo "✓ Refreshed $BASELINE (${SIG_COUNT} signatures) and $CEILING_FILE (${RAW_COUNT} errors)."
  exit 0
fi

if [[ ! -f "$BASELINE" ]]; then
  echo "✗ Missing baseline $BASELINE — run: npm run type-check:server:baseline" >&2
  exit 1
fi

# New = signatures present now but absent from the baseline.
NEW="$(comm -23 "$TMP_NORM" "$BASELINE")"
if [[ -n "$NEW" ]]; then
  echo ""
  echo "✗ NV-SERVER-TYPES: new server type errors introduced (not in baseline):" >&2
  echo "$NEW" >&2
  echo "" >&2
  echo "Fix the error(s) above. If you intentionally reduced the backlog, refresh" >&2
  echo "the baseline with: npm run type-check:server:baseline" >&2
  exit 1
fi

# The ratchet: a known signature reappearing in new places must not slip through.
if [[ -f "$CEILING_FILE" ]]; then
  CEILING="$(tr -d '[:space:]' < "$CEILING_FILE")"
  if [[ -n "$CEILING" ]] && (( RAW_COUNT > CEILING )); then
    echo ""
    echo "✗ NV-SERVER-TYPES: error COUNT rose ${CEILING} → ${RAW_COUNT}." >&2
    echo "  Every signature is already known, so a pre-existing error class has spread to new" >&2
    echo "  call sites. Fix those, or refresh if this is a deliberate, reviewed trade." >&2
    exit 1
  fi
  if [[ -n "$CEILING" ]] && (( RAW_COUNT < CEILING )); then
    echo "✓ NV-SERVER-TYPES: backlog REDUCED ${CEILING} → ${RAW_COUNT}. Run"
    echo "  npm run type-check:server:baseline to lower the ceiling permanently."
    exit 0
  fi
fi

echo "✓ NV-SERVER-TYPES: no NEW server type errors (backlog: ${RAW_COUNT} errors / ${SIG_COUNT} signatures)."
exit 0
