#!/usr/bin/env bash
# Push probe-fb399-counsel-durable.mjs to nysdev and run (SSM). NV-SECRETS-001.
set -euo pipefail
APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_ROOT"
source scripts/jrx-source-dev-deploy-env.sh

PROBE="$APP_ROOT/scripts/probe-fb399-counsel-durable.mjs"
RUNNER="$APP_ROOT/scripts/_ec2-fb399-run-probe.sh"
for f in "$PROBE" "$RUNNER"; do
  [ -f "$f" ] || { echo "missing $f" >&2; exit 2; }
done

if base64 -w0 "$PROBE" >/dev/null 2>&1; then
  P64=$(base64 -w0 "$PROBE")
  R64=$(base64 -w0 "$RUNNER")
else
  P64=$(base64 < "$PROBE" | tr -d '\n')
  R64=$(base64 < "$RUNNER" | tr -d '\n')
fi

COMMENT="fb399-counsel-durable-$(date -u +%Y%m%dT%H%M%SZ)"
CMD_ID=$(aws ssm send-command \
  --region "$NYV_AWS_REGION" \
  --instance-ids "$NYV_EC2_INSTANCE_ID" \
  --document-name AWS-RunShellScript \
  --comment "$COMMENT" \
  --timeout-seconds 720 \
  --parameters "commands=[\"mkdir -p /tmp/jrx-fb399 && echo $P64 | base64 -d > /tmp/jrx-fb399/probe.mjs && echo $R64 | base64 -d > /tmp/jrx-fb399/run.sh && sed -i 's|probe-fb399-counsel-durable.mjs|/tmp/jrx-fb399/probe.mjs|' /tmp/jrx-fb399/run.sh && bash /tmp/jrx-fb399/run.sh\"]" \
  --query Command.CommandId --output text)

echo "SSM command_id=$CMD_ID"

for _ in $(seq 1 150); do
  st=$(aws ssm get-command-invocation \
    --region "$NYV_AWS_REGION" \
    --command-id "$CMD_ID" \
    --instance-id "$NYV_EC2_INSTANCE_ID" \
    --query Status --output text 2>/dev/null || echo Pending)
  case "$st" in Success|Failed|Cancelled|TimedOut) break ;; *) sleep 5 ;; esac
done

aws ssm get-command-invocation \
  --region "$NYV_AWS_REGION" \
  --command-id "$CMD_ID" \
  --instance-id "$NYV_EC2_INSTANCE_ID" \
  --query '[Status,StandardOutputContent,StandardErrorContent]' \
  --output text

echo "done status=$st command_id=$CMD_ID"
