#!/usr/bin/env bash
set -uo pipefail
HERE=/home/ubuntu/scripts/data_rds
echo "=== EXPORT STATE $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
cat /home/ubuntu/scripts/case_api/_build/case_lookup_full/_CURRENT 2>/dev/null || true
ls -la /home/ubuntu/scripts/case_api/_build/case_lookup_full/v_* 2>/dev/null
echo "--- export work done files ---"
ls -1 "$HERE/_export/work"/done-*.json 2>/dev/null | wc -l
ls -1 "$HERE/_export/work"/done-*.json 2>/dev/null | tail -3
echo "--- cases_csv partition count ---"
find "$HERE/_export/cases_csv" -name '*.csv.gz' 2>/dev/null | wc -l
echo "--- prune candidate v_20260924T064432Z ---"
du -sh /home/ubuntu/scripts/case_api/_build/case_lookup_full/v_20260924T064432Z 2>/dev/null
echo "=== DONE ==="
