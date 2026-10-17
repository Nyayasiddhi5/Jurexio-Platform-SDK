#!/usr/bin/env bash
set -uo pipefail
grep -R -n -E 'display_pdf|appFlag|app_flag|mobile_depth|fetch_order|download.*pdf' /home/ubuntu/scripts/case_api /home/ubuntu/scripts/data_rds 2>/dev/null \
  | grep -vE '_migration|jsonl|__pycache__|\.venv|_build/api_' | head -35
echo DONE
