#!/usr/bin/env bash
# Start DuckDB→RDS mirror via systemd (NV-NYS-OPS-GO-004).
set -uo pipefail
echo "=== START case-api-rds-daily $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
systemctl is-enabled case-api-rds-daily.timer 2>/dev/null || true
systemctl is-active case-api-rds-daily.service 2>/dev/null || true
if systemctl is-active --quiet case-api-rds-daily.service 2>/dev/null; then
  echo "ALREADY_ACTIVE"
  systemctl status case-api-rds-daily.service --no-pager | head -15
  exit 0
fi
if pgrep -f '/home/ubuntu/scripts/data_rds/rds_daily.sh' >/dev/null 2>&1; then
  echo "ALREADY_RUNNING pid=$(pgrep -f '/home/ubuntu/scripts/data_rds/rds_daily.sh' | head -1)"
  exit 0
fi
sudo systemctl start case-api-rds-daily.service
sleep 2
systemctl status case-api-rds-daily.service --no-pager | head -20
echo "=== START DISPATCHED ==="
