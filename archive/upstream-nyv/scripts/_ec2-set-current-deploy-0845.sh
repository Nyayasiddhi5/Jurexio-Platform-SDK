#!/usr/bin/env bash
set -euo pipefail
TARGET="2026-09-12T0845Z-aws-ssm-94bececc"
echo "BEFORE: $(cat /opt/Nyayavigya/CURRENT_DEPLOY 2>/dev/null || echo missing)"
echo "$TARGET" > /opt/Nyayavigya/CURRENT_DEPLOY
echo "$TARGET" > /opt/Nyayavigya/LAST_GOOD_DEPLOY
echo "AFTER: $(cat /opt/Nyayavigya/CURRENT_DEPLOY)"
echo "disk: $(df -h / | tail -1 | awk '{print $5" used of "$2}')"
echo "health5000: $(curl -sS -o /dev/null -w '%{http_code}' -m 5 http://127.0.0.1:5000/api/jrx/health)"
echo "health80: $(curl -sS -o /dev/null -w '%{http_code}' -m 5 http://127.0.0.1/api/jrx/health)"
LIVE="/opt/Nyayavigya/repo/${TARGET}"
if [ -d "$LIVE/src/services/jrx-partner-fast-post-process.ts" ] || grep -q enforceStatuteFastPathSources "$LIVE/src/services/jrx-client.ts" 2>/dev/null; then
  echo "94bececc_marker=PRESENT"
else
  echo "94bececc_marker=CHECK_MANUALLY"
fi
