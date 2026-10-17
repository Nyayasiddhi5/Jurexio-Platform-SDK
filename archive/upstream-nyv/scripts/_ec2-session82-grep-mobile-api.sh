#!/usr/bin/env bash
set -uo pipefail
grep -R -n -E 'app\.ecourts|mobile.*HC|case_status|businessDate|fetchCase' /home/ubuntu/scripts/data_rds /home/ubuntu/scripts/case_api 2>/dev/null \
  | grep -v recon_samples | grep -v __pycache__ | grep -v jsonl | head -30
echo DONE
