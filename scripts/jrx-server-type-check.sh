#!/usr/bin/env bash
# JRX-SERVER-TYPECHECK-001 — gateway/server compile gate (tsconfig.server.json).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BASELINE="${ROOT}/.tsc-server-baseline.txt"
CEILING="${ROOT}/.tsc-server-ceiling.txt"

normalize_server_errors() {
  npx tsc --project tsconfig.server.json --noEmitOnError 2>&1 \
    | grep -E 'error TS[0-9]+' \
    | sed -E 's/^([^(]+)\([0-9]+,[0-9]+\): (error TS[0-9]+:.*)/\1: \2/' \
    | sort -u
}

if [[ "${1:-}" == "--refresh" ]]; then
  normalize_server_errors > "$BASELINE" || true
  wc -l < "$BASELINE" | tr -d ' ' > "$CEILING"
  echo "jrx-server-type-check: refreshed baseline ($(cat "$CEILING") signatures)"
  exit 0
fi

if ! npx tsc --project tsconfig.server.json --noEmitOnError >/dev/null 2>&1; then
  echo "jrx-server-type-check FAIL: tsconfig.server.json --noEmitOnError" >&2
  npx tsc --project tsconfig.server.json --noEmitOnError 2>&1 | tail -20 >&2
  exit 1
fi

CURRENT="$(mktemp)"
normalize_server_errors > "$CURRENT" || true
if [[ -f "$BASELINE" ]]; then
  NEW="$(comm -23 "$CURRENT" "$BASELINE" 2>/dev/null || true)"
  if [[ -n "$NEW" ]]; then
    echo "jrx-server-type-check FAIL: new error signatures (refresh with --refresh after review):" >&2
    echo "$NEW" | head -20 >&2
    rm -f "$CURRENT"
    exit 1
  fi
fi

COUNT="$(wc -l < "$CURRENT" | tr -d ' ')"
MAX="$(cat "$CEILING" 2>/dev/null || echo 0)"
if [[ "$COUNT" -gt "$MAX" ]]; then
  echo "jrx-server-type-check FAIL: error count $COUNT exceeds ceiling $MAX" >&2
  rm -f "$CURRENT"
  exit 1
fi

rm -f "$CURRENT"
echo "jrx-server-type-check PASS (0 compile errors, ${COUNT} baseline signatures)"
