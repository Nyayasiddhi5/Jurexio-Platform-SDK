#!/usr/bin/env bash
# NV-LIVE-EVAL-15-001 — full counsel-grade run on nysdev (read-only).
set -uo pipefail

CANON="/opt/Nyayavigya/secrets/.env.production"
read_env() { grep -E "^${1}=" "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n'; }

export NYV_SDK_KEY_NSP="$(read_env NYV_SDK_KEY_NSP)"
echo "CONTROL C1 key_len=${#NYV_SDK_KEY_NSP} (MUST be 64)"
if [[ ${#NYV_SDK_KEY_NSP} -lt 32 ]]; then
  echo "PROBE BROKEN — key read failed"
  exit 2
fi

GATEWAY="http://127.0.0.1:5000"
ctl=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "${GATEWAY}/api/jrx/health" 2>/dev/null || echo 000)
echo "CONTROL C2 health_http=${ctl} (000 = probe cannot reach gateway)"

img=$(docker inspect nyv-gateway --format '{{.Config.Image}}' 2>/dev/null || true)
started=$(docker inspect nyv-gateway --format '{{.State.StartedAt}}' 2>/dev/null || true)
echo "CONTROL deploy_image=${img}"
echo "CONTROL container_started=${started}"

DEP="$(cat /opt/Nyayavigya/CURRENT_DEPLOY 2>/dev/null || cat /opt/nyayavigya/CURRENT_DEPLOY 2>/dev/null || echo missing)"
echo "CONTROL current_deploy=${DEP}"

: "${SET_B64:?SET_B64 required — 15-case eval set not in deploy image}"
docker exec nyv-gateway mkdir -p /app/docs/audit/eval
printf '%s' "$SET_B64" | base64 -d > /tmp/jrx-counsel-grade-set.v1.json
docker cp /tmp/jrx-counsel-grade-set.v1.json nyv-gateway:/app/docs/audit/eval/jrx-counsel-grade-set.v1.json

case_count=$(docker exec nyv-gateway node -e "
const s=require('/app/docs/audit/eval/jrx-counsel-grade-set.v1.json');
console.log(s.cases.length);
" 2>/dev/null || echo 0)
echo "CONTROL case_count=${case_count} (MUST be 15)"
if [[ "$case_count" != "15" ]]; then
  echo "PROBE BROKEN — eval set seed failed"
  exit 2
fi

LABEL="${LABEL:-live-eval-0540Z-fe966a94}"
TIMEOUT_MS="${NYV_COUNSEL_GRADE_TIMEOUT_MS:-180000}"

docker exec -e NYV_SDK_KEY_NSP -e NYV_COUNSEL_GRADE_TIMEOUT_MS="$TIMEOUT_MS" \
  -w /app nyv-gateway \
  npx tsx scripts/jrx-eval-counsel-grade.ts \
  --gateway "$GATEWAY" \
  --key-env NYV_SDK_KEY_NSP \
  --label "$LABEL" \
  --timeout "$TIMEOUT_MS" \
  2>&1 | tee /tmp/jrx-cg-full-live.txt

docker cp nyv-gateway:/app/.local/benchmarks/. /tmp/jrx-cg-benchmarks/ 2>/dev/null || true
LATEST=$(ls -td /tmp/jrx-cg-benchmarks/${LABEL}-* 2>/dev/null | head -1 || true)
if [[ -z "$LATEST" ]]; then
  LATEST=$(ls -td /tmp/jrx-cg-benchmarks/counsel-grade-* 2>/dev/null | head -1 || true)
fi

if [[ -n "$LATEST" && -f "$LATEST/counsel-grade.json" ]]; then
  echo "ARTIFACT_DIR=$(basename "$LATEST")"
  echo "SUMMARY_BEGIN"
  node -e "
const a=require('$LATEST/counsel-grade.json');
console.log('totals:', JSON.stringify(a.totals));
for (const c of a.cases) {
  const fail = c.assertions.filter(x=>x.status==='fail').map(x=>x.id);
  const blk = c.blockedCount>0;
  console.log(c.caseId + '|' + (blk?'blocked':(fail.length?'fail':'ok')) + '|' + (c.latencyMs||'?') + 'ms|' + c.bodyChars + 'ch|' + (fail.join(',')||'-'));
}
" 2>/dev/null || true
  echo "SUMMARY_END"
  echo "PAYLOAD_BEGIN"
  gzip -9 -c "$LATEST/counsel-grade.json" | base64 -w0 2>/dev/null || gzip -9 -c "$LATEST/counsel-grade.json" | base64 | tr -d '\n'
  echo ""
  echo "PAYLOAD_END"
else
  echo "NO ARTIFACT"
  tail -30 /tmp/jrx-cg-full-live.txt
  exit 1
fi
