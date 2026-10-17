#!/usr/bin/env bash
# NV-TRACKER-FRESH-001 (Session-15 v5, 2026-05-11)
#
# Guardrail: every session that touches code, schema, or feature wiring MUST
# append an entry to the canonical session tracker before the changes are
# allowed to merge. Without this guardrail, the tracker silently rots
# between sessions (Sessions 15 v1-v5 of work missing from the tracker is
# what triggered this guardrail's creation).
#
# Mandate: replit.md § Hard architectural guardrails NV-TRACKER-FRESH-001.
#
# How it decides:
#   1. Find the most recent git commit touching any of:
#        src/, client/src/, drizzle/, examples/, scripts/, packages/
#   2. Find the most recent git commit touching the tracker:
#        docs/canonical/10-tracker-changelog-2026-05-07.md
#   3. If the source commit is strictly newer than the tracker commit, the
#      tracker is STALE — fail with a clear remediation message.
#
# How to fix when this fails:
#   1. Open docs/canonical/10-tracker-changelog-2026-05-07.md
#   2. Append a `## Session-NN (YYYY-MM-DD) — <one-line title>` block at
#      the bottom with sub-sections:
#        Goal / Outcome / Files / Guardrails / Smoke / Followups / Commit
#   3. git add docs/canonical/10-tracker-changelog-2026-05-07.md
#   4. Re-run: bash scripts/jrx-check-tracker-fresh.sh
#
# Override (only for genuine doc-only edits, never for code shipping):
#   NYV_TRACKER_FRESH_TOLERATE=1 bash scripts/jrx-check-tracker-fresh.sh
#
# Run locally:  bash scripts/jrx-check-tracker-fresh.sh
# CI:           npm run guardrail:tracker-fresh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TRACKER="docs/canonical/10-tracker-changelog-2026-05-07.md"
SOURCE_PATHS=(src client/src drizzle examples scripts packages)

if [ "${NYV_TRACKER_FRESH_TOLERATE:-0}" = "1" ]; then
  echo "  ⚠ NV-TRACKER-FRESH-001 SKIPPED (NYV_TRACKER_FRESH_TOLERATE=1 set)"
  exit 0
fi

if ! command -v git >/dev/null 2>&1; then
  echo "  ⚠ NV-TRACKER-FRESH-001 SKIPPED (git not available in this environment)"
  exit 0
fi

if [ ! -f "$TRACKER" ]; then
  echo "  ✗ NV-TRACKER-FRESH-001: tracker file is missing: $TRACKER"
  echo "    The canonical tracker is required by replit.md NV-DOC-001 §10."
  exit 1
fi

# Resolve to a git working tree once, so all subsequent calls share it.
if ! git --no-optional-locks rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "  ⚠ NV-TRACKER-FRESH-001 SKIPPED (not inside a git work tree)"
  exit 0
fi

# Most recent commit timestamp (unix epoch) touching any source path.
SRC_TS=0
SRC_COMMIT=""
for p in "${SOURCE_PATHS[@]}"; do
  if [ -e "$p" ]; then
    line=$(git --no-optional-locks log -1 --format="%ct %H" -- "$p" 2>/dev/null || true)
    if [ -n "$line" ]; then
      ts=$(echo "$line" | awk '{print $1}')
      sha=$(echo "$line" | awk '{print $2}')
      if [ "$ts" -gt "$SRC_TS" ]; then
        SRC_TS=$ts
        SRC_COMMIT="$sha"
      fi
    fi
  fi
done

# Most recent commit timestamp touching the tracker file.
TRK_LINE=$(git --no-optional-locks log -1 --format="%ct %H" -- "$TRACKER" 2>/dev/null || true)
TRK_TS=0
TRK_COMMIT=""
if [ -n "$TRK_LINE" ]; then
  TRK_TS=$(echo "$TRK_LINE" | awk '{print $1}')
  TRK_COMMIT=$(echo "$TRK_LINE" | awk '{print $2}')
fi

if [ "$SRC_TS" -eq 0 ]; then
  echo "  ⚠ NV-TRACKER-FRESH-001 SKIPPED (no source commits found — fresh repo?)"
  exit 0
fi

if [ "$TRK_TS" -ge "$SRC_TS" ]; then
  echo "  ✓ NV-TRACKER-FRESH-001: tracker is fresh"
  echo "    last source commit:  $(git --no-optional-locks show -s --format='%h %ad %s' --date=short "$SRC_COMMIT" 2>/dev/null || echo "$SRC_COMMIT")"
  echo "    last tracker commit: $(git --no-optional-locks show -s --format='%h %ad %s' --date=short "$TRK_COMMIT" 2>/dev/null || echo "$TRK_COMMIT")"
  exit 0
fi

# Stale — list the source commits the tracker is behind.
BEHIND=$(git --no-optional-locks log --format="    %h %ad %s" --date=short "$TRK_COMMIT".."$SRC_COMMIT" -- "${SOURCE_PATHS[@]}" 2>/dev/null | head -10 || true)

cat <<EOF

  ✗ NV-TRACKER-FRESH-001: tracker is STALE

    The canonical session tracker has not been updated since the latest
    source-touching commit. Per replit.md § Hard architectural guardrails
    NV-TRACKER-FRESH-001, every session that touches code/schema/wiring
    MUST append a Session-NN entry to the tracker before merge.

    tracker:    $TRACKER
    last update: $(git --no-optional-locks show -s --format='%h %ad %s' --date=short "$TRK_COMMIT" 2>/dev/null || echo "$TRK_COMMIT")
    last src:    $(git --no-optional-locks show -s --format='%h %ad %s' --date=short "$SRC_COMMIT" 2>/dev/null || echo "$SRC_COMMIT")

    Source-touching commits the tracker is missing (up to 10):
$BEHIND

    Fix:
      1. Open $TRACKER
      2. Append a '## Session-NN (YYYY-MM-DD) — <title>' block at the bottom
         with sub-sections: Goal / Outcome / Files / Guardrails / Smoke /
         Followups / Commit
      3. git add $TRACKER
      4. Re-run: bash scripts/jrx-check-tracker-fresh.sh

    Override (doc-only edits ONLY, never for code shipping):
      NYV_TRACKER_FRESH_TOLERATE=1 npm run guardrail:tracker-fresh

EOF
exit 1
