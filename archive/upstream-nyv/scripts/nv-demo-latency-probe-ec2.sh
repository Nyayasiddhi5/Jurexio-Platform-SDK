#!/usr/bin/env bash
# Latency + cache repeat + stream TTFB probe ON nysdev via SSM.
# NV-SECRETS-001: keys stay on EC2 — never echo secret values.
set -euo pipefail
APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$APP_ROOT/scripts/jrx-source-dev-deploy-env.sh"

PROBE="$APP_ROOT/scripts/_ec2-latency-cache-probe.sh"
if [ ! -f "$PROBE" ]; then
  echo "missing probe script: $PROBE" >&2
  exit 2
fi

if base64 -w0 "$PROBE" >/dev/null 2>&1; then
  B64=$(base64 -w0 "$PROBE")
else
  B64=$(base64 < "$PROBE" | tr -d '\n')
fi

COMMENT="latency-cache-probe-$(date -u +%Y%m%dT%H%M%SZ)"
CMD_ID=$(aws ssm send-command \
  --region "$NYV_AWS_REGION" \
  --instance-ids "$NYV_EC2_INSTANCE_ID" \
  --document-name AWS-RunShellScript \
  --comment "$COMMENT" \
  --parameters "commands=[\"echo $B64 | base64 -d | bash\"]" \
  --query Command.CommandId --output text)

echo "SSM command_id=$CMD_ID instance=$NYV_EC2_INSTANCE_ID"

for _ in $(seq 1 120); do
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

echo "done status=$st command_id=$CMD_ID"
