#!/usr/bin/env bash
# JRX demo crosscheck on Jurexio EC2 via SSM — health, key lens, partner GETs (no secret values).
set -euo pipefail

JRX_EC2_INSTANCE_ID="${JRX_EC2_INSTANCE_ID:-i-0fb470b236c14405b}"
JRX_AWS_REGION="${JRX_AWS_REGION:-ap-south-1}"

if [ "$JRX_EC2_INSTANCE_ID" = "i-0df71e5ea1df8f588" ]; then
  echo "Refusing forbidden EC2 deploy target." >&2
  exit 3
fi

command -v aws >/dev/null 2>&1 || { echo "aws cli required" >&2; exit 1; }

REMOTE='set -uo pipefail
CANON="/opt/Jurexio/secrets/.env.production"
BASE="http://127.0.0.1:5000"
echo "=== KEY LENS (chars only) ==="
for k in JRX_SDK_KEY_NSP JRX_SDK_KEY NYV_SDK_KEY_NSP; do
  n="$(grep -E "^${k}=" "$CANON" 2>/dev/null | head -1 | wc -c || echo 0)"
  echo "  ${k}_line_chars=${n}"
done
echo "=== HEALTH ==="
curl -sS -m 15 -o /tmp/jrx_h.json -w "health http=%{http_code} ms=%{time_total}\n" "$BASE/api/jrx/health" || true
echo "=== PARTNER (with NSP key if present) ==="
NSPK="$(grep -E "^JRX_SDK_KEY_NSP=" "$CANON" 2>/dev/null | head -1 | cut -d= -f2- | tr -d "\r\n\"'"'"'")"
if [ "$(printf %s "$NSPK" | wc -c)" -lt 16 ]; then
  echo "partner SKIP key_too_short"
  exit 0
fi
for path in /api/jrx/v1/sdk/docparse/health /api/jrx/v1/sdk/llm/router/health /api/jrx/orchestrate; do
  curl -sS -m 30 -o /dev/null -w "  ${path} http=%{http_code} ms=%{time_total}\n" \
    -H "X-API-Key: ${NSPK}" -H "X-JRX-Platform: nsp" "$BASE${path}" || true
done
echo "=== DEPLOY STAMP ==="
cat /opt/Jurexio/CURRENT_DEPLOY 2>/dev/null || ls -la /opt/Jurexio/current 2>/dev/null | head -3 || true
'

SSM_PARAMS="$(jq -n --arg cmd "$REMOTE" '{commands: [$cmd]}')"
CMD_ID="$(aws ssm send-command --region "$JRX_AWS_REGION" --instance-ids "$JRX_EC2_INSTANCE_ID" \
  --document-name AWS-RunShellScript --parameters "$SSM_PARAMS" \
  --query Command.CommandId --output text)"
echo "==> SSM command_id=${CMD_ID}"
aws ssm wait command-executed --region "$JRX_AWS_REGION" --command-id "$CMD_ID" \
  --instance-id "$JRX_EC2_INSTANCE_ID" 2>/dev/null || true
aws ssm get-command-invocation --region "$JRX_AWS_REGION" --command-id "$CMD_ID" \
  --instance-id "$JRX_EC2_INSTANCE_ID" --query StandardOutputContent --output text
STATUS="$(aws ssm get-command-invocation --region "$JRX_AWS_REGION" --command-id "$CMD_ID" \
  --instance-id "$JRX_EC2_INSTANCE_ID" --query Status --output text)"
echo "==> SSM status=${STATUS}"
[ "$STATUS" = Success ] || exit 1
