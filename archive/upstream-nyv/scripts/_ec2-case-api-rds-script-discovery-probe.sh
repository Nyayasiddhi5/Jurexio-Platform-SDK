#!/usr/bin/env bash
# Discover RDS mirror scripts on caselaw-worker case_api tree (read-only).
set -uo pipefail
ROOT="/home/ubuntu/scripts/case_api"
echo "=== RDS SCRIPT DISCOVERY $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
grep -rniE 'rds_daily|rds_load_state|cases_search_staging' "$ROOT" --include='*.sh' --include='*.py' --include='*.md' 2>/dev/null | head -60
echo "--- build/ listing ---"
ls -la "$ROOT/build/" 2>/dev/null
echo "--- head refresh_daily.sh ---"
head -80 "$ROOT/build/refresh_daily.sh" 2>/dev/null || echo "no refresh_daily"
echo "--- head start_api_with_rds.sh ---"
head -40 "$ROOT/build/start_api_with_rds.sh" 2>/dev/null || echo "no start_api_with_rds"
echo "--- find rds* ---"
find "$ROOT" -maxdepth 3 \( -name '*rds*' -o -name '*daily*' \) -type f 2>/dev/null | head -30
echo "=== DISCOVERY DONE ==="
