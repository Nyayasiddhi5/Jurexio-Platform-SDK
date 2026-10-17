#!/usr/bin/env bash
set -euo pipefail
APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$APP_ROOT/scripts/jrx-source-dev-deploy-env.sh"
PROBE="$APP_ROOT/scripts/_ec2-claude55-live-config-verify.sh"
B64=$(base64 < "$PROBE" | tr -d '\n')
CMD_ID=$(aws ssm send-command --region "$NYV_AWS_REGION" --instance-ids "$NYV_EC2_INSTANCE_ID" \
  --document-name AWS-RunShellScript --comment claude55-live-verify \
  --parameters "commands=[\"echo $B64 | base64 -d | bash\"]" --query Command.CommandId --output text)
for _ in $(seq 1 30); do
  st=$(aws ssm get-command-invocation --region "$NYV_AWS_REGION" --command-id "$CMD_ID" \
    --instance-id "$NYV_EC2_INSTANCE_ID" --query Status --output text 2>/dev/null || echo Pending)
  case "$st" in Success|Failed) break;; *) sleep 3;; esac
done
aws ssm get-command-invocation --region "$NYV_AWS_REGION" --command-id "$CMD_ID" \
  --instance-id "$NYV_EC2_INSTANCE_ID" --query StandardOutputContent --output text
