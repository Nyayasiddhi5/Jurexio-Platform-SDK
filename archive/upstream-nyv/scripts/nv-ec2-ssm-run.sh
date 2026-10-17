#!/usr/bin/env bash
# Run a local script on EC2 via SSM (base64 pipe). Usage:
#   bash scripts/jrx-ec2-ssm-run.sh scripts/_ec2-p0-diag.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
source scripts/jrx-source-dev-deploy-env.sh

SCRIPT="${1:?usage: nv-ec2-ssm-run.sh <local-script>}"
COMMENT="${2:-ec2-ssm-run}"
: "${NYV_EC2_INSTANCE_ID:?}"
: "${NYV_AWS_REGION:=ap-south-1}"

if [[ ! -f "$SCRIPT" ]]; then
  echo "missing script: $SCRIPT" >&2
  exit 1
fi

if printf '' | base64 -w0 >/dev/null 2>&1; then
  B64=$(base64 -w0 < "$SCRIPT")
else
  B64=$(base64 < "$SCRIPT" | tr -d '\n')
fi

CMD_ID=$(aws ssm send-command \
  --region "$NYV_AWS_REGION" \
  --instance-ids "$NYV_EC2_INSTANCE_ID" \
  --document-name AWS-RunShellScript \
  --comment "$COMMENT" \
  --parameters "commands=[\"echo $B64 | base64 -d | bash\"]" \
  --query Command.CommandId --output text)

echo "SSM command: $CMD_ID"
for _ in $(seq 1 60); do
  status=$(aws ssm get-command-invocation \
    --region "$NYV_AWS_REGION" \
    --command-id "$CMD_ID" \
    --instance-id "$NYV_EC2_INSTANCE_ID" \
    --query Status --output text 2>/dev/null || echo Pending)
  case "$status" in
    Success|Failed|Cancelled|TimedOut) break ;;
    *) sleep 3 ;;
  esac
done

echo "Status: $status"
aws ssm get-command-invocation \
  --region "$NYV_AWS_REGION" \
  --command-id "$CMD_ID" \
  --instance-id "$NYV_EC2_INSTANCE_ID" \
  --query StandardOutputContent --output text || true

if [[ "$status" != Success ]]; then
  echo "--- stderr ---" >&2
  aws ssm get-command-invocation \
    --region "$NYV_AWS_REGION" \
    --command-id "$CMD_ID" \
    --instance-id "$NYV_EC2_INSTANCE_ID" \
    --query StandardErrorContent --output text >&2 || true
  exit 1
fi
