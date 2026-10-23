#!/usr/bin/env bash
# Run a local script on the NYS caselaw-worker EC2 host via SSM (base64 pipe).
# Mirrors scripts/jrx-ec2-ssm-run.sh but targets the NYS instance, which is a
# separate host from the JRX gateway (see AGENTS.md §0 dual-project ops).
#   bash scripts/_nys-ssm-run.sh /tmp/probe.sh "label"
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
source scripts/jrx-source-dev-deploy-env.sh

SCRIPT="${1:?usage: _nys-ssm-run.sh <local-script> [comment]}"
COMMENT="${2:-nys-ssm-run}"
JRX_ECOSYSTEM_INSTANCE_ID="${JRX_ECOSYSTEM_EC2_INSTANCE_ID:-i-000115b19219bb766}"
: "${JRX_AWS_REGION:=ap-south-1}"

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
  --region "$JRX_AWS_REGION" \
  --instance-ids "$JRX_ECOSYSTEM_INSTANCE_ID" \
  --document-name AWS-RunShellScript \
  --comment "$COMMENT" \
  --parameters "commands=[\"echo $B64 | base64 -d | bash\"]" \
  --timeout-seconds "${JRX_ECOSYSTEM_SSM_TIMEOUT_SECONDS:-3600}" \
  --query Command.CommandId --output text)

echo "SSM command: $CMD_ID (instance $JRX_ECOSYSTEM_INSTANCE_ID)"
JRX_ECOSYSTEM_SSM_POLL_MAX="${JRX_ECOSYSTEM_SSM_POLL_MAX:-100}"
JRX_ECOSYSTEM_SSM_POLL_SLEEP="${JRX_ECOSYSTEM_SSM_POLL_SLEEP:-3}"
for _ in $(seq 1 "$JRX_ECOSYSTEM_SSM_POLL_MAX"); do
  status=$(aws ssm get-command-invocation \
    --region "$JRX_AWS_REGION" \
    --command-id "$CMD_ID" \
    --instance-id "$JRX_ECOSYSTEM_INSTANCE_ID" \
    --query Status --output text 2>/dev/null || echo Pending)
  case "$status" in
    Success|Failed|Cancelled|TimedOut) break ;;
    *) sleep "$JRX_ECOSYSTEM_SSM_POLL_SLEEP" ;;
  esac
done

echo "Status: $status"
aws ssm get-command-invocation \
  --region "$JRX_AWS_REGION" \
  --command-id "$CMD_ID" \
  --instance-id "$JRX_ECOSYSTEM_INSTANCE_ID" \
  --query StandardOutputContent --output text || true

if [[ "$status" != Success ]]; then
  echo "--- stderr ---" >&2
  aws ssm get-command-invocation \
    --region "$JRX_AWS_REGION" \
    --command-id "$CMD_ID" \
    --instance-id "$JRX_ECOSYSTEM_INSTANCE_ID" \
    --query StandardErrorContent --output text >&2 || true
  exit 1
fi
