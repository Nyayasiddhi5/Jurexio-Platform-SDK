#!/usr/bin/env bash
set -uo pipefail
for f in \
  /home/ubuntu/scripts/case_api/build/refresh_hcservices_depth.sh \
  /home/ubuntu/scripts/case_api/build/ingest_hcservices_depth.py
do
  echo "=== $f ==="
  head -80 "$f" 2>/dev/null || echo missing
done
echo DONE
