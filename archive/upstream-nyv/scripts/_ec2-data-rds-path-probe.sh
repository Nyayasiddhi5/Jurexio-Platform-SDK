#!/usr/bin/env bash
set -uo pipefail
echo "=== DATA_RDS PATH PROBE $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
for p in \
  /home/ubuntu/scripts/data_rds \
  /home/ubuntu/scripts/data_rds/rds_daily.sh \
  /home/ubuntu/scripts/case_api/rds_daily.sh \
  /home/ec2-user/scripts/data_rds/rds_daily.sh; do
  if [ -e "$p" ]; then
    echo "EXISTS $p"
    [ -f "$p" ] && ls -la "$p" && head -5 "$p"
  else
    echo "MISSING $p"
  fi
done
echo "--- ls /home/ubuntu/scripts ---"
ls -la /home/ubuntu/scripts/ 2>/dev/null
echo "--- ls data_rds if any ---"
find /home/ubuntu/scripts -maxdepth 3 -type d -name 'data_rds' 2>/dev/null
find /home/ubuntu -maxdepth 4 -name 'rds_daily.sh' 2>/dev/null
echo "--- case-api-rds-daily unit ---"
systemctl cat case-api-rds-daily.service 2>/dev/null | head -40
systemctl status case-api-rds-daily.service --no-pager 2>/dev/null | head -15
echo "=== PROBE DONE ==="
