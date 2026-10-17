#!/usr/bin/env bash
# NV-LIVE-EVAL-15-001 — run full counsel-grade set on nysdev via SSM.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
source scripts/jrx-source-dev-deploy-env.sh

: "${NYV_EC2_INSTANCE_ID:?}"
: "${NYV_AWS_REGION:=ap-south-1}"

LABEL="${1:-live-eval-0540Z-fe966a94}"
TIMEOUT_MS="${NYV_COUNSEL_GRADE_TIMEOUT_MS:-180000}"
SSM_TIMEOUT="${NYV_COUNSEL_GRADE_SSM_TIMEOUT:-3600}"

if base64 -w0 scripts/_ec2-counsel-grade-full-live.sh >/dev/null 2>&1; then
  B64=$(base64 -w0 < scripts/_ec2-counsel-grade-full-live.sh)
  SET_B64=$(base64 -w0 < docs/audit/eval/jrx-counsel-grade-set.v1.json)
else
  B64=$(base64 < scripts/_ec2-counsel-grade-full-live.sh | tr -d '\n')
  SET_B64=$(base64 < docs/audit/eval/jrx-counsel-grade-set.v1.json | tr -d '\n')
fi

PARAMS=".local/tmp/cg-live-ssm.json"
mkdir -p .local/tmp
node -e "
const fs = require('fs');
const [params, scriptB64, setB64, label, timeoutMs] = process.argv.slice(1);
fs.writeFileSync(params, JSON.stringify({ commands: [
  'SET_B64=' + JSON.stringify(setB64) + ' LABEL=' + JSON.stringify(label) +
  ' NYV_COUNSEL_GRADE_TIMEOUT_MS=' + JSON.stringify(timeoutMs) +
  ' bash -c \"echo ' + scriptB64 + ' | base64 -d | bash\"',
] }));
" "$PARAMS" "$B64" "$SET_B64" "$LABEL" "$TIMEOUT_MS"

echo "Launching counsel-grade live eval on EC2 (SSM timeout=${SSM_TIMEOUT}s, per-case=${TIMEOUT_MS}ms)..."
CMD_ID=$(aws ssm send-command \
  --region "$NYV_AWS_REGION" \
  --instance-ids "$NYV_EC2_INSTANCE_ID" \
  --document-name AWS-RunShellScript \
  --comment "NV-LIVE-EVAL-15-001-${LABEL}" \
  --timeout-seconds "$SSM_TIMEOUT" \
  --parameters "file://${PARAMS}" \
  --query Command.CommandId --output text)
rm -f "$PARAMS"
echo "SSM command: $CMD_ID"

deadline=$(( $(date +%s) + SSM_TIMEOUT + 60 ))
status=Pending
while [[ $(date +%s) -lt $deadline ]]; do
  status=$(aws ssm get-command-invocation --region "$NYV_AWS_REGION" \
    --command-id "$CMD_ID" --instance-id "$NYV_EC2_INSTANCE_ID" \
    --query Status --output text 2>/dev/null || echo Pending)
  case "$status" in
    Success|Failed|Cancelled|TimedOut) break ;;
    *) sleep 20 ;;
  esac
done
echo "Status: $status"

RAW=".local/tmp/cg-live-raw.txt"
mkdir -p .local/tmp .local/benchmarks
aws ssm get-command-invocation --region "$NYV_AWS_REGION" \
  --command-id "$CMD_ID" --instance-id "$NYV_EC2_INSTANCE_ID" \
  --query StandardOutputContent --output text > "$RAW" 2>/dev/null || true

grep -E '^CONTROL|^ARTIFACT|^SUMMARY|^  →|NV-COUNSEL|cases |assertions |totals:' "$RAW" || true
awk '/SUMMARY_BEGIN/,/SUMMARY_END/' "$RAW" | grep -v SUMMARY_ || true

if grep -q PAYLOAD_BEGIN "$RAW"; then
  ART_DIR=$(grep '^ARTIFACT_DIR=' "$RAW" | head -1 | cut -d= -f2-)
  DEST=".local/benchmarks/${ART_DIR}"
  mkdir -p "$DEST"
  awk '/PAYLOAD_BEGIN/{f=1;next}/PAYLOAD_END/{f=0}f' "$RAW" | tr -d '\n ' | base64 -d | gunzip > "$DEST/counsel-grade.json"
  node -e 'const a=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); console.log(JSON.stringify(a.totals,null,2));' "$DEST/counsel-grade.json"
  echo "Saved: $DEST/counsel-grade.json"
else
  echo "NO PAYLOAD — stderr:" >&2
  aws ssm get-command-invocation --region "$NYV_AWS_REGION" \
    --command-id "$CMD_ID" --instance-id "$NYV_EC2_INSTANCE_ID" \
    --query StandardErrorContent --output text >&2 || true
  tail -40 "$RAW" >&2 || true
  exit 1
fi
