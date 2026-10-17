#!/usr/bin/env bash
set -uo pipefail
echo "=== DISK AUDIT $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
df -h / /home/ubuntu 2>/dev/null
echo "--- top du /home/ubuntu (depth 2) ---"
du -xh /home/ubuntu 2>/dev/null | sort -hr | head -25
echo "--- case_lookup_full versions ---"
du -sh /home/ubuntu/scripts/case_api/_build/case_lookup_full/v_* 2>/dev/null | sort -hr
echo "--- data_rds _export _delta ---"
du -sh /home/ubuntu/scripts/data_rds/_export /home/ubuntu/scripts/data_rds/_delta 2>/dev/null || true
echo "--- pgrep reconcile ---"
pgrep -af 'export_cases_for_rds|rds_daily|apply_delta' || echo none
echo "=== DONE ==="
