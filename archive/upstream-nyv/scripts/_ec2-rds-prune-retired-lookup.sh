#!/usr/bin/env bash
# Remove retired lookup version (has _RETIRED_AT) to free disk for export/apply temp.
set -euo pipefail
V=/home/ubuntu/scripts/case_api/_build/case_lookup_full/v_20260924T064432Z
CUR=$(python3 -c "import json; print(json.load(open('/home/ubuntu/scripts/case_api/_build/case_lookup_full/_CURRENT'))['version'])")
echo "CURRENT=$CUR"
if [[ "$CUR" == "v_20260924T064432Z" ]]; then
  echo "REFUSING: would delete current published predecessor still referenced"
  exit 1
fi
[[ -f "$V/_RETIRED_AT" ]] || { echo "REFUSING: no _RETIRED_AT on $V"; exit 2; }
du -sh "$V"
rm -rf "$V"
echo "PRUNED $V"
df -h / | tail -1
