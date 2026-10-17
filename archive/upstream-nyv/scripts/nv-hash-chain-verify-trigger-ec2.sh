#!/usr/bin/env bash
set -euo pipefail
APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$APP_ROOT/scripts/jrx-source-dev-deploy-env.sh"
PROBE="$APP_ROOT/scripts/_ec2-hash-chain-verify-trigger.sh"
if base64 -w0 "$PROBE" >/dev/null 2>&1; then B64=$(base64 -w0 "$PROBE"); else B64=$(base64 < "$PROBE" | tr -d '\n'); fi
CMD_ID=$(aws ssm send-command --region "$NYV_AWS_REGION" --instance-ids "$NYV_EC2_INSTANCE_ID" \
  --document-name AWS-RunShellScript --comment "hash-chain-verify-trigger-$(date -u +%Y%m%dT%H%M%SZ)" \
  --parameters "commands=[\"echo $B64 | base64 -d | bash\"]" \
  --query Command.CommandId --output text)
echo "SSM command_id=$CMD_ID"
for _ in $(seq 1 60); do
  st=$(aws ssm get-command-invocation --region "$NYV_AWS_REGION" --command-id "$CMD_ID" \
    --instance-id "$NYV_EC2_INSTANCE_ID" --query Status --output text 2>/dev/null || echo Pending)
  case "$st" in Success|Failed|Cancelled|TimedOut) break ;; *) sleep 3 ;; esac
done
aws ssm get-command-invocation --region "$NYV_AWS_REGION" --command-id "$CMD_ID" \
  --instance-id "$NYV_EC2_INSTANCE_ID" --query '[Status,StandardOutputContent,StandardErrorContent]' --output text
echo "done status=$st command_id=$CMD_ID"
