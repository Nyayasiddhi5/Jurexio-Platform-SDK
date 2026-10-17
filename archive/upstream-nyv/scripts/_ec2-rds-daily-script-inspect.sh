#!/usr/bin/env bash
set -uo pipefail
RDS=/home/ubuntu/scripts/data_rds/rds_daily.sh
echo "=== rds_daily inspect $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
ls -la "$RDS" 2>&1
echo "--- grep flags / usage ---"
grep -nE 'full.scan|allow.shrink|REFUS|FATAL|usage|\-\-' "$RDS" 2>/dev/null | head -60
echo "--- head 80 ---"
head -80 "$RDS"
echo "--- tail 40 ---"
tail -40 "$RDS"
