#!/usr/bin/env bash
set -uo pipefail
F=/home/ubuntu/scripts/case_api/app/mapping.py
sed -n '760,860p' "$F"
echo "--- schema HcOrderRecord ---"
grep -n -A15 'class HcOrderRecord' /home/ubuntu/scripts/case_api/app/schema.py | head -25
echo "--- grep display_pdf entire case_api ---"
grep -R -n 'display_pdf' /home/ubuntu/scripts/case_api /opt/nyv 2>/dev/null | head -20
echo DONE
