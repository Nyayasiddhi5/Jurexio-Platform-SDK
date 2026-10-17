#!/usr/bin/env bash
set -euo pipefail
APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$APP_ROOT/scripts/jrx-source-dev-deploy-env.sh"
PROBE="$APP_ROOT/scripts/_ec2-tswl-cnr-search-probe.sh"
B64=$(base64 < "$PROBE" | tr -d '\n')
COMMENT="tswl-cnr-search-$(date -u +%Y%m%dT%H%M%SZ)"
CMD_ID=$(aws ssm send-command \
  --region "$NYV_AWS_REGION" \
  --instance-ids "$NYV_EC2_INSTANCE_ID" \
  --document-name AWS-RunShellScript \
  --comment "$COMMENT" \
  --parameters "commands=[\"echo $B64 | base64 -d > /tmp/tswl-probe.sh && bash /tmp/tswl-probe.sh\"]" \
  --query Command.CommandId --output text)
echo "SSM command_id=$CMD_ID instance=$NYV_EC2_INSTANCE_ID"
for _ in $(seq 1 30); do
  STATUS=$(aws ssm get-command-invocation --command-id "$CMD_ID" --instance-id "$NYV_EC2_INSTANCE_ID" --query Status --output text 2>/dev/null || echo Pending)
  if [ "$STATUS" = "Success" ] || [ "$STATUS" = "Failed" ]; then
    aws ssm get-command-invocation --command-id "$CMD_ID" --instance-id "$NYV_EC2_INSTANCE_ID" --query '[Status,StandardOutputContent,StandardErrorContent]' --output text
    [ "$STATUS" = "Success" ] || exit 1
    exit 0
  fi
  sleep 2
done
echo "timeout waiting for SSM" >&2
exit 2
