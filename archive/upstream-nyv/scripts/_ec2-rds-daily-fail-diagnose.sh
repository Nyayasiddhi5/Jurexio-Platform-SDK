#!/usr/bin/env bash
# NV-NYS-OPS — diagnose case-api-rds-daily.service fast-fail
set -uo pipefail
echo "=== RDS_DAILY FAIL DIAG $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo "--- systemctl status ---"
systemctl status case-api-rds-daily.service --no-pager 2>&1 | head -25
echo "--- last 50 journal lines ---"
journalctl -u case-api-rds-daily.service -n 50 --no-pager 2>&1
echo "--- unit file ---"
systemctl cat case-api-rds-daily.service 2>/dev/null | head -50
echo "--- timer ---"
systemctl list-timers case-api-rds-daily.timer --no-pager 2>/dev/null || true
echo "--- rds_daily.log tail ---"
for log in /home/ubuntu/scripts/data_rds/rds_daily.log /var/log/rds_daily.log; do
  if [ -f "$log" ]; then
    echo "LOG $log"
    tail -50 "$log"
  else
    echo "NO_LOG $log"
  fi
done
echo "--- disk ---"
df -h / /home/ubuntu 2>/dev/null | head -5
echo "--- pgrep rds_daily ---"
pgrep -af 'rds_daily' || echo "no rds_daily process"
echo "--- lock files ---"
find /home/ubuntu/scripts/data_rds -maxdepth 2 -name '*.lock' -o -name '*lock*' 2>/dev/null | head -20
echo "--- script perms ---"
ls -la /home/ubuntu/scripts/data_rds/rds_daily.sh 2>&1 || true
echo "--- dry run first 30 lines of script (grep guards) ---"
grep -nE 'REFUS|FATAL|exit |set -e|watermark|table_version|published' /home/ubuntu/scripts/data_rds/rds_daily.sh 2>/dev/null | head -40
echo "--- nysapi health tableVersion (curl local) ---"
curl -sf --max-time 5 http://127.0.0.1:8080/health 2>/dev/null | head -c 500 || curl -sf --max-time 5 http://127.0.0.1:3000/health 2>/dev/null | head -c 500 || echo "health curl failed"
echo "=== DIAG DONE ==="
