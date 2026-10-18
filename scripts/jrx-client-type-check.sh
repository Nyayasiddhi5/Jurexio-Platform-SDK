#!/usr/bin/env bash
# JRX-CLIENT-TYPECHECK-001 — console baseline-diff gate (no new TS signatures).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BASELINE="${ROOT}/client/.tsc-baseline.txt"

normalize_client_errors() {
  npx tsc -p client/tsconfig.json --noEmit 2>&1 \
    | grep -E 'error TS[0-9]+' \
    | sed -E 's/^([^(]+)\([0-9]+,[0-9]+\): (error TS[0-9]+:.*)/\1: \2/' \
    | sort -u
}

if [[ "${1:-}" == "--refresh" ]]; then
  normalize_client_errors > "$BASELINE" || true
  echo "jrx-client-type-check: refreshed baseline ($(wc -l < "$BASELINE" | tr -d ' ') signatures)"
  exit 0
fi

CURRENT="$(mktemp)"
normalize_client_errors > "$CURRENT" || true
NEW="$(comm -23 "$CURRENT" "$BASELINE" 2>/dev/null || cat "$CURRENT")"
if [[ -s "$NEW" ]]; then
  echo "jrx-client-type-check FAIL: new error signatures:" >&2
  head -20 "$NEW" >&2
  rm -f "$CURRENT"
  exit 1
fi

rm -f "$CURRENT"
echo "jrx-client-type-check PASS (no new signatures vs baseline)"
