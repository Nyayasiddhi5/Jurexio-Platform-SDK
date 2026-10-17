#!/usr/bin/env bash
# Workstation: enable eCourtsIndia on nysdev (reads key from .local/secrets/ecourtsindia.env).
set -euo pipefail
APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$APP_ROOT/scripts/jrx-source-dev-deploy-env.sh"
SECRETS_FILE="${NYV_ECOURTSINDIA_SECRETS_FILE:-$APP_ROOT/../.local/secrets/ecourtsindia.env}"
if [ ! -f "$SECRETS_FILE" ]; then
  SECRETS_FILE="$APP_ROOT/.local/secrets/ecourtsindia.env"
fi
[ -f "$SECRETS_FILE" ] || { echo "FATAL: missing $SECRETS_FILE (NYV_ECOURTSINDIA_API_KEY=)"; exit 1; }
# shellcheck disable=SC1090
source "$SECRETS_FILE"
KEY="${NYV_ECOURTSINDIA_API_KEY:-}"
[ "${#KEY}" -gt 20 ] || { echo "FATAL: NYV_ECOURTSINDIA_API_KEY length"; exit 1; }
KEY_B64=$(printf '%s' "$KEY" | base64 | tr -d '\n')

run_ssm_b64() {
  local script_path="$1"
  local comment="$2"
  local arg_b64="$3"
  local PATCH_B64
  PATCH_B64=$(base64 < "$script_path" | tr -d '\n')
  local CMD_ID
  aws ssm send-command \
    --region "$NYV_AWS_REGION" \
    --instance-ids "$NYV_EC2_INSTANCE_ID" \
    --document-name AWS-RunShellScript \
    --comment "$comment" \
    --parameters commands="echo ${PATCH_B64} | base64 -d | bash -s ${arg_b64}" \
    --query Command.CommandId --output text
}

poll_ssm() {
  local CMD_ID="$1"
  local st=""
  for _ in $(seq 1 120); do
    st=$(aws ssm get-command-invocation --region "$NYV_AWS_REGION" --command-id "$CMD_ID" \
      --instance-id "$NYV_EC2_INSTANCE_ID" --query Status --output text 2>/dev/null || echo Pending)
    case "$st" in Success|Failed|Cancelled|TimedOut) break ;; *) sleep 5 ;; esac
  done
  aws ssm get-command-invocation --region "$NYV_AWS_REGION" --command-id "$CMD_ID" \
    --instance-id "$NYV_EC2_INSTANCE_ID" --query '[Status,StandardOutputContent,StandardErrorContent]' --output text
  test "$st" = Success
}

echo "==> patch ecourtsindia"
CMD_ID=$(run_ssm_b64 "$APP_ROOT/scripts/_ec2-ecourtsindia-enable-patch.sh" "ecourtsindia-enable-$(date -u +%Y%m%dT%H%M%SZ)" "$KEY_B64")
echo "SSM command_id=$CMD_ID"
poll_ssm "$CMD_ID"
echo "==> probe cascade"
CMD_ID2=$(aws ssm send-command \
  --region "$NYV_AWS_REGION" \
  --instance-ids "$NYV_EC2_INSTANCE_ID" \
  --document-name AWS-RunShellScript \
  --comment "ecourtsindia-cnr-probe-$(date -u +%Y%m%dT%H%M%SZ)" \
  --parameters commands="echo $(base64 < "$APP_ROOT/scripts/_ec2-ecourtsindia-cnr-probe.sh" | tr -d '\n') | base64 -d | bash" \
  --query Command.CommandId --output text)
poll_ssm "$CMD_ID2"
echo "==> probe partner webapi"
CMD_ID3=$(aws ssm send-command \
  --region "$NYV_AWS_REGION" \
  --instance-ids "$NYV_EC2_INSTANCE_ID" \
  --document-name AWS-RunShellScript \
  --comment "ecourtsindia-webapi-probe-$(date -u +%Y%m%dT%H%M%SZ)" \
  --parameters commands="echo $(base64 < "$APP_ROOT/scripts/_ec2-ecourtsindia-partner-webapi-probe.sh" | tr -d '\n') | base64 -d | bash" \
  --query Command.CommandId --output text)
poll_ssm "$CMD_ID3"
