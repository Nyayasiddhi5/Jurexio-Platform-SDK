#!/usr/bin/env bash
set -uo pipefail
grep -R -n -E 'display_pdf|appFlag|app_flag|state_cd|order_date1f|mobile_depth|hcservices' /home/ubuntu/scripts 2>/dev/null \
  | grep -vE '_migration|\.jsonl|__pycache__|\.venv' | head -40
echo DONE
