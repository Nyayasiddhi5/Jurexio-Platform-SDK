#!/usr/bin/env bash
set -uo pipefail
BASE="/home/ubuntu/scripts/case_api"
echo "=== FIND rds_daily $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
find "$BASE" -name 'rds_daily*.sh' -o -name 'apply_delta_to_rds.sh' -o -name 'run_sql.sh' 2>/dev/null
echo "--- data_rds ---"
ls -la "$BASE/data_rds" 2>/dev/null || ls -la "$BASE"/**/data_rds 2>/dev/null | head -20
find "$BASE" -path '*/data_rds/*' -name '*.sh' 2>/dev/null | head -20
echo "--- crontab/systemd rds ---"
systemctl list-units --all 2>/dev/null | grep -iE 'rds|case-api|refresh' | head -15
grep -rni 'rds_daily' /etc/systemd/system/ 2>/dev/null | head -10
crontab -l 2>/dev/null | grep -i rds || echo "no user crontab rds"
sudo crontab -l 2>/dev/null | grep -iE 'rds|daily' | head -5 || echo "no root crontab"
echo "=== FIND DONE ==="
