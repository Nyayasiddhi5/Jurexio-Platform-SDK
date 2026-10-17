#!/usr/bin/env bash
set -uo pipefail
sed -n '760,860p' /home/ubuntu/scripts/case_api/app/mapping.py
grep -n -A15 'class HcOrderRecord' /home/ubuntu/scripts/case_api/app/schema.py | head -25
grep -R -n 'display_pdf' /home/ubuntu/scripts/case_api/app 2>/dev/null | head -10
echo DONE
