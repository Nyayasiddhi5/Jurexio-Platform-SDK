#!/usr/bin/env bash
# JRX-TRACKER-FRESH-001 — source commits must not outpace tracker doc updates.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ "${JRX_TRACKER_FRESH_TOLERATE:-}" == "1" ]]; then
  echo "jrx-check-tracker-fresh: JRX_TRACKER_FRESH_TOLERATE=1 override"
  exit 0
fi

TRACKER_PATHS=(Project-Tracker.md CHANGELOG.md)
SOURCE_PATHS=(src client/src drizzle packages shared scripts)

last_src="$(git log -1 --format=%ct -- "${SOURCE_PATHS[@]}" 2>/dev/null || echo 0)"
last_tracker="$(git log -1 --format=%ct -- "${TRACKER_PATHS[@]}" 2>/dev/null || echo 0)"

if [[ "$last_src" -gt "$last_tracker" ]]; then
  echo "jrx-check-tracker-fresh FAIL: source tree committed after Project-Tracker.md / CHANGELOG.md"
  echo "  latest source: $(git log -1 --format='%h %ci %s' -- "${SOURCE_PATHS[@]}")"
  echo "  latest tracker: $(git log -1 --format='%h %ci %s' -- "${TRACKER_PATHS[@]}" 2>/dev/null || echo 'none')"
  exit 1
fi

echo "jrx-check-tracker-fresh PASS"
