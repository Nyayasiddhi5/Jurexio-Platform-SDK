#!/usr/bin/env bash
set -uo pipefail
echo "=== RDS VERSION ON DISK $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
LOOKUP="${CASE_API_LOOKUP_TABLE_URI:-/home/ubuntu/scripts/case_api/_build/case_lookup_full}"
echo "LOOKUP=$LOOKUP"
for v in v_20260923T092637Z v_20260924T072259Z v_20260923T163900Z; do
  if [ -d "$LOOKUP/$v" ] || [ -e "$LOOKUP/$v" ]; then
    echo "ON_DISK $v"
  else
    echo "MISSING $v"
  fi
done
echo "--- recent versions (newest 8) ---"
ls -1dt "$LOOKUP"/v_* 2>/dev/null | head -8 || ls -1dt /home/ubuntu/scripts/case_api/_build/*/v_* 2>/dev/null | head -8
echo "--- published pointer ---"
cat /home/ubuntu/scripts/case_api/_build/published_table_version 2>/dev/null || cat "$LOOKUP/../published_table_version" 2>/dev/null || true
echo "=== DONE ==="
