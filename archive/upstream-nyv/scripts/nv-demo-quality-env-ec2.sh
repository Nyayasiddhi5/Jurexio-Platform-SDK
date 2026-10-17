#!/usr/bin/env bash
set -euo pipefail
APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$APP_ROOT/scripts/jrx-source-dev-deploy-env.sh"
PATCH="$APP_ROOT/scripts/_ec2-demo-quality-llm-env-patch.sh"
B64=$(base64 < "$PATCH" | tr -d '\n')
CMD_ID=$(aws ssm send-command \
  --region "$NYV_AWS_REGION" \
  --instance-ids "$NYV_EC2_INSTANCE_ID" \
  --document-name AWS-RunShellScript \
  --comment "demo-quality-env-$(date -u +%Y%m%dT%H%M%SZ)" \
  --parameters "commands=[\"echo $B64 | base64 -d | bash\",\"docker compose -f /opt/Nyayavigya/docker-compose.aws-dev.yml up -d nyv-gateway 2>/dev/null || docker restart nyv-gateway\"]" \
  --query Command.CommandId --output text)
echo "SSM command_id=$CMD_ID (restart gateway after env patch)"
