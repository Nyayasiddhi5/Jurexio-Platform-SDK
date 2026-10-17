#!/usr/bin/env bash
# Workstation driver: patch + probe docparse NSP visual flags on nysdev via SSM.
set -euo pipefail
APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$APP_ROOT/scripts/jrx-source-dev-deploy-env.sh"

run_ssm() {
  local probe="$1"
  local comment="$2"
  local B64
  B64=$(base64 < "$probe" | tr -d '\n')
  local CMD_ID
  CMD_ID=$(aws ssm send-command \
    --region "$NYV_AWS_REGION" \
    --instance-ids "$NYV_EC2_INSTANCE_ID" \
    --document-name AWS-RunShellScript \
    --comment "$comment" \
    --parameters "commands=[\"echo $B64 | base64 -d | bash\"]" \
    --query Command.CommandId --output text)
  echo "SSM command_id=$CMD_ID"
  local st=""
  for _ in $(seq 1 90); do
    st=$(aws ssm get-command-invocation --region "$NYV_AWS_REGION" --command-id "$CMD_ID" \
      --instance-id "$NYV_EC2_INSTANCE_ID" --query Status --output text 2>/dev/null || echo Pending)
    case "$st" in Success|Failed|Cancelled|TimedOut) break ;; *) sleep 5 ;; esac
  done
  aws ssm get-command-invocation --region "$NYV_AWS_REGION" --command-id "$CMD_ID" \
    --instance-id "$NYV_EC2_INSTANCE_ID" --query '[Status,StandardOutputContent,StandardErrorContent]' --output text
  echo "done status=$st"
  test "$st" = Success
}

echo "==> patch"
run_ssm "$APP_ROOT/scripts/_ec2-docparse-nsp-visual-flags-patch.sh" "docparse-nsp-flags-patch-$(date -u +%Y%m%dT%H%M%SZ)"
echo "==> probe"
run_ssm "$APP_ROOT/scripts/_ec2-docparse-nsp-flags-probe.sh" "docparse-nsp-flags-probe-$(date -u +%Y%m%dT%H%M%SZ)"
