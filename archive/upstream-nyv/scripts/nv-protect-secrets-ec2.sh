#!/usr/bin/env bash
# Run _ec2-protect-secrets-before-prune.sh ON nysdev via SSM.
# Usage: cd nyayavigya-platform-312 && npm run protect:secrets:ec2
set -euo pipefail
APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$APP_ROOT/scripts/jrx-source-dev-deploy-env.sh"

PROBE="$APP_ROOT/scripts/_ec2-protect-secrets-before-prune.sh"
[ -f "$PROBE" ] || { echo "missing: $PROBE" >&2; exit 2; }

if base64 -w0 "$PROBE" >/dev/null 2>&1; then
  B64=$(base64 -w0 "$PROBE")
else
  B64=$(base64 < "$PROBE" | tr -d '\n')
fi

COMMENT="protect-secrets-$(date -u +%Y%m%dT%H%M%SZ)"
CMD_ID=$(aws ssm send-command \
  --region "$NYV_AWS_REGION" \
  --instance-ids "$NYV_EC2_INSTANCE_ID" \
  --document-name AWS-RunShellScript \
  --comment "$COMMENT" \
  --parameters "commands=[\"echo $B64 | base64 -d | sudo bash\"]" \
  --query Command.CommandId --output text)

echo "SSM command_id=$CMD_ID instance=$NYV_EC2_INSTANCE_ID"
for _ in $(seq 1 30); do
  st=$(aws ssm get-command-invocation \
    --region "$NYV_AWS_REGION" \
    --command-id "$CMD_ID" \
    --instance-id "$NYV_EC2_INSTANCE_ID" \
    --query Status --output text 2>/dev/null || echo Pending)
  case "$st" in Success|Failed|Cancelled|TimedOut) break ;; *) sleep 2 ;; esac
done
aws ssm get-command-invocation \
  --region "$NYV_AWS_REGION" \
  --command-id "$CMD_ID" \
  --instance-id "$NYV_EC2_INSTANCE_ID" \
  --query '[Status,StandardOutputContent,StandardErrorContent]' \
  --output text
echo "done status=$st"
