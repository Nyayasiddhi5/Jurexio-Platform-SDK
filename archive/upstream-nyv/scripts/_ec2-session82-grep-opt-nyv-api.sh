#!/usr/bin/env bash
set -uo pipefail
grep -n -E 'display_pdf|finalOrder|mobile_depth|hcservices|order.*pdf|captcha' /opt/nyv/api/index.mjs 2>/dev/null | head -20
grep -l -E 'display_pdf|mobile_depth|hcservices' /opt/nyv/api/*.mjs 2>/dev/null | head -15
for f in /opt/nyv/api/ingest-cnr-case-details.mjs /opt/nyv/api/_phase-b2-cnr-standalone.mjs; do
  [ -f "$f" ] && echo "=== $f ===" && grep -n -E 'display_pdf|order|mobile|hcservices|captcha' "$f" | head -15
done
echo DONE
