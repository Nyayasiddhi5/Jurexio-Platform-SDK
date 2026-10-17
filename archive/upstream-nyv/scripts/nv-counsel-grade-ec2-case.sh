#!/usr/bin/env bash
# NV-COUNSEL-GRADE-EVAL-001 — drive one orchestrate case on nysdev over SSM and
# decode its captured response into .local/probes/captures/.
#
# `nv-ec2-ssm-run.sh` cannot pass env vars to the remote script, and this capture
# needs CASE_ID / BODY_B64 / BUDGET, so it builds its own send-command. Read-only:
# it POSTs to /api/jrx/orchestrate and nothing else.
#
# Usage:  bash scripts/jrx-counsel-grade-ec2-case.sh <caseId> [budgetSeconds]
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
source scripts/jrx-source-dev-deploy-env.sh

CASE_ID="${1:?usage: nv-counsel-grade-ec2-case.sh <caseId> [budgetSeconds]}"
BUDGET="${2:-200}"
SET_FILE="${NYV_COUNSEL_GRADE_SET:-docs/audit/eval/jrx-counsel-grade-set.v1.json}"
: "${NYV_EC2_INSTANCE_ID:?}"
: "${NYV_AWS_REGION:=ap-south-1}"

OUTDIR=".local/probes/captures"
mkdir -p "$OUTDIR" .local/tmp

# Take the request body straight from the committed prompt set so the live probe
# and the graded set can never drift apart.
BODY_B64="$(node -e '
const fs = require("fs");
const set = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const c = set.cases.find((x) => x.id === process.argv[2]);
if (!c) { console.error("no such case: " + process.argv[2]); process.exit(2); }
if (c.endpoint !== "orchestrate") { console.error("not an orchestrate case: " + c.id); process.exit(2); }
process.stdout.write(Buffer.from(JSON.stringify(c.request)).toString("base64"));
' "$SET_FILE" "$CASE_ID")" || exit 2

SCRIPT_B64="$(base64 < scripts/_ec2-counsel-grade-capture-orchestrate.sh | tr -d '\n')"

PARAMS=".local/tmp/cg-ssm-${CASE_ID}.json"
node -e '
const fs = require("fs");
const [params, script, caseId, bodyB64, budget] = process.argv.slice(1);
fs.writeFileSync(params, JSON.stringify({ commands: [
  `CASE_ID=${JSON.stringify(caseId)} BODY_B64=${JSON.stringify(bodyB64)} BUDGET=${JSON.stringify(budget)} bash -c "echo ${script} | base64 -d > /tmp/jrx-cg.sh; bash /tmp/jrx-cg.sh"`,
] }));
' "$PARAMS" "$SCRIPT_B64" "$CASE_ID" "$BODY_B64" "$BUDGET"

CMD_ID=$(aws ssm send-command \
  --region "$NYV_AWS_REGION" \
  --instance-ids "$NYV_EC2_INSTANCE_ID" \
  --document-name AWS-RunShellScript \
  --comment "counsel-grade-${CASE_ID}" \
  --timeout-seconds $((BUDGET + 120)) \
  --parameters "file://${PARAMS}" \
  --query Command.CommandId --output text) || exit 2
rm -f "$PARAMS"
echo "SSM command: $CMD_ID  case=$CASE_ID budget=${BUDGET}s"

deadline=$(( $(date +%s) + BUDGET + 180 ))
status=Pending
while [[ $(date +%s) -lt $deadline ]]; do
  status=$(aws ssm get-command-invocation --region "$NYV_AWS_REGION" \
    --command-id "$CMD_ID" --instance-id "$NYV_EC2_INSTANCE_ID" \
    --query Status --output text 2>/dev/null || echo Pending)
  case "$status" in
    Success|Failed|Cancelled|TimedOut) break ;;
    *) sleep 10 ;;
  esac
done
echo "Status: $status"

RAW=".local/tmp/cg-raw-${CASE_ID}.txt"
aws ssm get-command-invocation --region "$NYV_AWS_REGION" \
  --command-id "$CMD_ID" --instance-id "$NYV_EC2_INSTANCE_ID" \
  --query StandardOutputContent --output text > "$RAW" 2>/dev/null || true

# Echo the controls, never the payload — a 24 KB base64 blob in the log is noise.
grep -E '^CONTROL|^CAPTURE' "$RAW" || true

if ! grep -q PAYLOAD_BEGIN "$RAW"; then
  echo "NO PAYLOAD — stderr follows (this is an instrument failure, not a quality result):" >&2
  aws ssm get-command-invocation --region "$NYV_AWS_REGION" \
    --command-id "$CMD_ID" --instance-id "$NYV_EC2_INSTANCE_ID" \
    --query StandardErrorContent --output text >&2 || true
  exit 1
fi

DEST="${OUTDIR}/counsel-grade-${CASE_ID}.json"
awk '/PAYLOAD_BEGIN/{f=1;next}/PAYLOAD_END/{f=0}f' "$RAW" | tr -d '\n ' | base64 -d | gunzip > "$DEST"
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); console.log("decoded OK → " + process.argv[1]);' "$DEST"
