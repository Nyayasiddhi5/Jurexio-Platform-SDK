#!/usr/bin/env bash
# Run a local script on the NYS caselaw worker via SSM. Mirrors
# scripts/jrx-ec2-ssm-run.sh but targets the NYS host, which is a different
# instance from the NYV gateway default.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
source scripts/jrx-source-dev-deploy-env.sh >/dev/null 2>&1

SCRIPT="${1:?usage: _nys-ssm.sh <local-script> [comment] [timeout-loops]}"
COMMENT="${2:-nys-ssm-run}"
LOOPS="${3:-60}"
NYS_INSTANCE_ID="i-000115b19219bb766"
REGION="${NYV_AWS_REGION:-ap-south-1}"

B64=$(base64 < "$SCRIPT" | tr -d '\n')
CMD_ID=$(aws ssm send-command \
  --region "$REGION" \
  --instance-ids "$NYS_INSTANCE_ID" \
  --document-name AWS-RunShellScript \
  --comment "$COMMENT" \
  --parameters "commands=[\"echo $B64 | base64 -d | bash\"]" \
  --query Command.CommandId --output text)
echo "SSM command: $CMD_ID"
for _ in $(seq 1 "$LOOPS"); do
  status=$(aws ssm get-command-invocation --region "$REGION" --command-id "$CMD_ID" \
    --instance-id "$NYS_INSTANCE_ID" --query Status --output text 2>/dev/null || echo Pending)
  case "$status" in Success|Failed|Cancelled|TimedOut) break ;; *) sleep 3 ;; esac
done
echo "Status: $status"
aws ssm get-command-invocation --region "$REGION" --command-id "$CMD_ID" \
  --instance-id "$NYS_INSTANCE_ID" --query StandardOutputContent --output text || true
echo "--- stderr ---"
aws ssm get-command-invocation --region "$REGION" --command-id "$CMD_ID" \
  --instance-id "$NYS_INSTANCE_ID" --query StandardErrorContent --output text | head -40 || true
