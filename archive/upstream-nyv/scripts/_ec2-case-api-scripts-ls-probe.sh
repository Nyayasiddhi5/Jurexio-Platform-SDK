#!/usr/bin/env bash
set -uo pipefail
echo "=== CASE_API LS $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
ls -la /home/ubuntu/scripts/case_api/ 2>/dev/null | head -40
find /home/ubuntu/scripts/case_api -maxdepth 2 -name '*rds*' -o -name '*daily*' 2>/dev/null | head -20
echo "=== LS DONE ==="
