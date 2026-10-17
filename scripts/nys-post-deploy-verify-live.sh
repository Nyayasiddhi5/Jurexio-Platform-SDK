#!/usr/bin/env bash
set -uo pipefail
echo "index_md5=$(md5sum /opt/nyv/api/index.mjs 2>/dev/null | awk '{print $1}' || echo missing)"
echo "api_status=$(systemctl is-active nyv-api 2>/dev/null || echo inactive)"
HC=$(curl -sf -o /dev/null -w '%{http_code}' localhost:8080/api/healthz 2>/dev/null || curl -s -o /dev/null -w '%{http_code}' localhost:8080/api/caselaw/stats 2>/dev/null || echo 000)
echo "health_http=$HC"
node -e "
const fs=require('fs');
const s=fs.readFileSync('/opt/nyv/api/index.mjs','utf8');
console.log('judgmentStructure=' + (s.includes('judgmentStructure')?'yes':'no'));
console.log('case_no_numeric_only=' + (s.includes('case_no_numeric_only')?'yes':'no'));
console.log('filterSupport=' + (s.includes('filterSupport')?'yes':'no'));
" 2>/dev/null || echo bundle_probe=fail
