#!/usr/bin/env bash
# JRX smoke via SSM on Jurexio EC2 — health + docparse health alias (no secrets printed).
set -euo pipefail
: "${JRX_EC2_INSTANCE_ID:?}"
: "${JRX_AWS_REGION:=ap-south-1}"

REMOTE='curl -sf http://127.0.0.1:5000/api/jrx/health | head -c 400; echo; curl -sf -o /dev/null -w '\''docparse_http=%{http_code}\n'\'' http://127.0.0.1:5000/api/jrx/v1/sdk/docparse/health || true'

SSM_PARAMS="$(jq -n --arg cmd "$REMOTE" '{commands: [$cmd]}')"

CMD_ID="$(aws ssm send-command --region "$JRX_AWS_REGION" --instance-ids "$JRX_EC2_INSTANCE_ID" \
  --document-name AWS-RunShellScript --parameters "$SSM_PARAMS" \
  --query Command.CommandId --output text)"
aws ssm wait command-executed --region "$JRX_AWS_REGION" --command-id "$CMD_ID" --instance-id "$JRX_EC2_INSTANCE_ID" || true
aws ssm get-command-invocation --region "$JRX_AWS_REGION" --command-id "$CMD_ID" \
  --instance-id "$JRX_EC2_INSTANCE_ID" --query StandardOutputContent --output text
