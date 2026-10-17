#!/usr/bin/env bash
set -uo pipefail
ROOT=/home/ubuntu/scripts/case_api/app
echo "=== depth / hcs files ==="
ls -la "$ROOT" 2>/dev/null | grep -iE 'hcs|depth|mobile|order' || true
find /home/ubuntu/scripts -maxdepth 3 -name '*hcservices*depth*' -o -name '*ingest*hc*' 2>/dev/null | head -15
echo "=== grep fetch_case_status / businessDate ==="
grep -R -n -E 'case_status|businessDate|fetchCase|pdf_url|authtoken|captcha' "$ROOT" /home/ubuntu/scripts/data_rds 2>/dev/null | head -25
echo DONE
