#!/usr/bin/env bash
# JRX-E2-OFFICIAL-CORPUS-001 — SG + GC official corpus on Jurexio RDS.
set -euo pipefail

JRX_EC2_INSTANCE_ID="${JRX_EC2_INSTANCE_ID:-i-0fb470b236c14405b}"
JRX_AWS_REGION="${JRX_AWS_REGION:-ap-south-1}"
JRX_FORBIDDEN_EC2="i-0df71e5ea1df8f588"
NV_TARGET="${NV_TARGET:-local}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ "$JRX_EC2_INSTANCE_ID" = "$JRX_FORBIDDEN_EC2" ]; then
  echo "Refusing forbidden EC2 deploy target." >&2
  exit 3
fi

run_local() {
  cd "$ROOT"
  : "${DATABASE_URL:?DATABASE_URL required for local ingest}"
  export RAG_BACKFILL="${RAG_BACKFILL:-1}"
  export LIMIT="${LIMIT:-20}"
  npx tsx scripts/jrx-e2-official-corpus-ingest.ts
}

run_ec2() {
  command -v aws >/dev/null 2>&1 || { echo "aws cli required for NV_TARGET=ec2" >&2; exit 1; }
  REMOTE='set -uo pipefail
cd /opt/Jurexio/current || cd /opt/Jurexio/repo/*/ 2>/dev/null || exit 1
set -a && source /opt/Jurexio/secrets/.env.production && set +a
export RAG_BACKFILL=1 LIMIT=20
if docker ps --format "{{.Names}}" | grep -q "^jrx-gateway$"; then
  docker exec -e RAG_BACKFILL -e LIMIT -e JURISDICTION -e DRY_RUN -e SG_SOLID_EXPORT jrx-gateway npx tsx scripts/jrx-e2-official-corpus-ingest.ts
else
  npx tsx scripts/jrx-e2-official-corpus-ingest.ts
fi
'
  SSM_PARAMS="$(jq -n --arg cmd "$REMOTE" '{commands: [$cmd]}')"
  CMD_ID="$(aws ssm send-command --region "$JRX_AWS_REGION" --instance-ids "$JRX_EC2_INSTANCE_ID" \
    --document-name AWS-RunShellScript --timeout-seconds 3600 \
    --parameters "$SSM_PARAMS" --query Command.CommandId --output text)"
  echo "==> SSM e2-official-corpus-ingest command_id=${CMD_ID}"
  aws ssm wait command-executed --region "$JRX_AWS_REGION" --command-id "$CMD_ID" \
    --instance-id "$JRX_EC2_INSTANCE_ID" 2>/dev/null || true
  aws ssm get-command-invocation --region "$JRX_AWS_REGION" --command-id "$CMD_ID" \
    --instance-id "$JRX_EC2_INSTANCE_ID" --query StandardOutputContent --output text
  STATUS="$(aws ssm get-command-invocation --region "$JRX_AWS_REGION" --command-id "$CMD_ID" \
    --instance-id "$JRX_EC2_INSTANCE_ID" --query Status --output text)"
  echo "==> SSM status=${STATUS}"
  [ "$STATUS" = Success ] || exit 1
}

echo "==> jrx-e2-official-corpus-ingest target=${NV_TARGET} instance=${JRX_EC2_INSTANCE_ID}"
case "$NV_TARGET" in
  local) run_local ;;
  ec2)   run_ec2 ;;
  *) echo "unknown NV_TARGET=$NV_TARGET (local|ec2)" >&2; exit 2 ;;
esac
