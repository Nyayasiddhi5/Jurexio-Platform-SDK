#!/usr/bin/env bash
# NV-NSP-STREAM-META-001 — SSE stream crosscheck on nysdev via SSM. NV-SECRETS-001.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
source scripts/jrx-source-dev-deploy-env.sh

PROBE="$ROOT/scripts/_ec2-nsp-stream-crosscheck-probe.sh"
[ -f "$PROBE" ] || { echo "missing $PROBE" >&2; exit 2; }

if base64 -w0 "$PROBE" >/dev/null 2>&1; then
  B64=$(base64 -w0 < "$PROBE")
else
  B64=$(base64 < "$PROBE" | tr -d '\n')
fi

COMMENT="nsp-stream-crosscheck-$(date -u +%Y%m%dT%H%M%SZ)"
CMD_ID=$(aws ssm send-command \
  --region "$NYV_AWS_REGION" \
  --instance-ids "$NYV_EC2_INSTANCE_ID" \
  --document-name AWS-RunShellScript \
  --comment "$COMMENT" \
  --timeout-seconds 900 \
  --parameters "commands=[\"echo $B64 | base64 -d | bash\"]" \
  --query Command.CommandId --output text)

echo "SSM command_id=$CMD_ID"

for _ in $(seq 1 120); do
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
  --query '[Status, StandardOutputContent, StandardErrorContent]' \
  --output text
