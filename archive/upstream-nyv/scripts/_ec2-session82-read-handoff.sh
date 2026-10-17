#!/usr/bin/env bash
set -uo pipefail
grep -n -iE 'order|pdf|mobile|tier|captcha|display_pdf' /home/ubuntu/scripts/data_rds/HANDOFF_2026-09-08_NIGHT.md 2>/dev/null | head -25
grep -n -iE 'order|pdf|mobile|tier|captcha' /home/ubuntu/scripts/data_rds/INSIGHTS_FROM_CASE_API_2026-09-08.md 2>/dev/null | head -25
echo DONE
