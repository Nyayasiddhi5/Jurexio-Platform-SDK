#!/usr/bin/env bash
# Post-deploy: enable Bedrock routing env + smoke + 10K gate on EC2 gateway container.
set -euo pipefail
LIVE="$(ls -dt /opt/Nyayavigya/repo/* 2>/dev/null | head -1)"
cd "$LIVE"
echo "[verify] LIVE=$LIVE"

# Ensure Bedrock aggregator flags in runtime .env (idempotent append)
grep -q '^NYV_BEDROCK_ENABLED=' .env 2>/dev/null || echo 'NYV_BEDROCK_ENABLED=on' >> .env
grep -q '^NYV_ROUTER_BEDROCK_FIRST=' .env 2>/dev/null || echo 'NYV_ROUTER_BEDROCK_FIRST=on' >> .env
grep -q '^AWS_BEDROCK_REGION=' .env 2>/dev/null || echo 'AWS_BEDROCK_REGION=ap-south-1' >> .env
grep -q '^NYV_PG_JOB_WORKER=' .env 2>/dev/null || echo 'NYV_PG_JOB_WORKER=on' >> .env
grep -q '^NYV_DOC_PROCESSOR_ENABLED=' .env 2>/dev/null || echo 'NYV_DOC_PROCESSOR_ENABLED=off' >> .env

docker compose -f docker-compose.aws-dev.yml up -d --force-recreate gateway
sleep 15
curl -sf http://127.0.0.1:5000/api/jrx/health | head -c 400
echo ""

echo "[verify] bedrock router explain"
docker compose -f docker-compose.aws-dev.yml exec -T gateway node -e "
const { pickSequence } = require('./dist/services/intelligent-router/intelligent-router.js');
const d = pickSequence({ tier: 'enterprise', jurisdiction: 'IN', taskKind: 'legal_research', app: 'NSP' });
console.log('primary', d.primary.provider, d.primary.id);
console.log('lead', d.sequence.slice(0,5).map(m=>m.provider+':'+m.id).join(' -> '));
" 2>/dev/null || echo "router explain via dist skipped"

echo "[verify] product readiness 10k"
export GATEWAY=http://127.0.0.1:5000
if [ -f scripts/jrx-product-readiness-10k.ts ]; then
  npx tsx scripts/jrx-product-readiness-10k.ts 2>&1 | tail -30
fi
