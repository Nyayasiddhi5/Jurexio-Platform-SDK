#!/usr/bin/env bash
set -uo pipefail
timeout 60 grep -R -n -E 'ecourt_mobile|mobile_HC|mobile_depth|authtoken|display_pdf' /home/ubuntu/scripts/data_rds /home/ubuntu/scripts/case_api/build 2>/dev/null \
  | grep -v recon_samples | grep -v __pycache__ | head -40
echo DONE
