#!/usr/bin/env bash
set -euo pipefail
APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$APP_ROOT/scripts/jrx-source-dev-deploy-env.sh"
PATCH="$APP_ROOT/scripts/_ec2-nsp-long-ai-timeout-env-patch.sh"
B64=$(base64 < "$PATCH" | tr -d '\n')
CMD_ID=$(aws ssm send-command \
  --region "$NYV_AWS_REGION" \
  --instance-ids "$NYV_EC2_INSTANCE_ID" \
  --document-name AWS-RunShellScript \
  --comment "nsp-long-ai-timeout-$(date -u +%Y%m%dT%H%M%SZ)" \
  --parameters "commands=[\"echo $B64 | base64 -d | bash && docker restart nyv-gateway\"]" \
  --query Command.CommandId --output text)
echo "SSM command_id=$CMD_ID"
for _ in $(seq 1 60); do
  st=$(aws ssm get-command-invocation \
    --region "$NYV_AWS_REGION" \
    --command-id "$CMD_ID" \
    --instance-id "$NYV_EC2_INSTANCE_ID" \
    --query Status --output text 2>/dev/null || echo Pending)
  case "$st" in Success|Failed|Cancelled|TimedOut) break ;; *) sleep 4 ;; esac
done
aws ssm get-command-invocation \
  --region "$NYV_AWS_REGION" \
  --command-id "$CMD_ID" \
  --instance-id "$NYV_EC2_INSTANCE_ID" \
  --query '[Status,StandardOutputContent,StandardErrorContent]' \
  --output text
