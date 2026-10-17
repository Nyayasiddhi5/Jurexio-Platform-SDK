#!/usr/bin/env bash
set -uo pipefail
timeout 45 grep -R -n -E 'display_pdf|appFlag|mobile_depth|order.*pdf|hcservices' /home/ubuntu/scripts/data_rds 2>/dev/null | head -30
echo DONE
