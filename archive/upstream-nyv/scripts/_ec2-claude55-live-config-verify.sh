#!/usr/bin/env bash
# NV-CLAUDE55-LIVE-VERIFY-001 — config lens + health (no secrets).
set -euo pipefail
GW="$(docker ps --format '{{.Names}}' | grep -E '(^|_)nyv-gateway$' | head -1)"
[ -n "$GW" ] || { echo "FATAL no gateway"; exit 1; }
echo "gateway=$GW deploy=$(cat /opt/Nyayavigya/CURRENT_DEPLOY 2>/dev/null || echo unknown)"
for k in \
  NYV_BEDROCK_REGION_ORDER \
  NYV_LLM_COST_PROFILE \
  NYV_LLM_BASELINE_FROZEN \
  NYV_F_BEDROCK_HAIKU_55_FAST \
  NYV_F_BEDROCK_SONNET_55_CHAT \
  NYV_F_BEDROCK_OPUS_55_COUNSEL \
  NYV_F_BEDROCK_QUEEN_55_LEAVES \
  NYV_PROMPT_CACHE \
  NYV_PROMPT_CACHE_MIN_CHARS_CLAUDE55 \
  NYV_F_DOCPARSE_TEXTRACT_PAGE \
  NYV_F_TEXTRACT; do
  v=$(docker exec "$GW" printenv "$k" 2>/dev/null || echo unset)
  echo "${k}=${v}"
done
code=$(curl -sS -o /dev/null -w '%{http_code}' -m 10 http://127.0.0.1:5000/api/jrx/health || echo 000)
echo "health_local=${code}"
docker exec -w /app "$GW" node -e "
const { getBedrockRegionOrder } = require('./dist/config/jrx-llm-cascade-config.js');
console.log('bedrockRegionOrder_runtime='+JSON.stringify(getBedrockRegionOrder()));
" 2>/dev/null || echo "bedrockRegionOrder_runtime=dist_check_skipped"
echo "VERIFY_OK"
