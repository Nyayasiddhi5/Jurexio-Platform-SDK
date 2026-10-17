#!/usr/bin/env bash
# Apply R-SCHEMA-B residual DDL on nysdev RDS via gateway container.
set -euo pipefail
cd "$(dirname "$0")/.."
INSTANCE="${NYV_EC2_INSTANCE:-i-0df71e5ea1df8f588}"
REGION="${AWS_REGION:-ap-south-1}"
SQL_SRC="migrations/2026-07-31-r-schema-b-residual.sql"
test -f "$SQL_SRC"

# Upload SQL to S3 (same deploy bucket), then SSM download+apply — avoids shell escaping hell.
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
S3_KEY="ops/r-schema-b-residual-${STAMP}.sql"
BUCKET="${NYV_DEPLOY_BUCKET:-nyayavigya-sdk-devapp}"
aws s3 cp "$SQL_SRC" "s3://${BUCKET}/${S3_KEY}" --region "$REGION"
echo "Uploaded s3://${BUCKET}/${S3_KEY}"

CMD_ID="$(aws ssm send-command \
  --instance-ids "$INSTANCE" \
  --document-name AWS-RunShellScript \
  --region "$REGION" \
  --timeout-seconds 120 \
  --output text --query 'Command.CommandId' \
  --parameters "{\"commands\":[\"set -euo pipefail\",\"aws s3 cp s3://${BUCKET}/${S3_KEY} /tmp/r-schema-b-residual.sql\",\"docker cp /tmp/r-schema-b-residual.sql nyv-gateway:/tmp/r-schema-b-residual.sql\",\"docker exec nyv-gateway node /app/scripts/jrx-apply-sql-file.cjs /tmp/r-schema-b-residual.sql\"]}")"

echo "SSM=$CMD_ID"
# Fallback inline node if helper missing on current image:
# re-send with inline apply if first fails — for now wait and also try inline.

sleep 3
# Prefer inline apply that doesn't need new file in image yet:
CMD_ID="$(aws ssm send-command \
  --instance-ids "$INSTANCE" \
  --document-name AWS-RunShellScript \
  --region "$REGION" \
  --timeout-seconds 180 \
  --output text --query 'Command.CommandId' \
  --parameters commands=["set -euo pipefail","aws s3 cp s3://${BUCKET}/${S3_KEY} /tmp/r-schema-b-residual.sql","docker cp /tmp/r-schema-b-residual.sql nyv-gateway:/tmp/r-schema-b-residual.sql","docker exec nyv-gateway node -e \"const {Client}=require('pg');const fs=require('fs');(async()=>{const u=process.env.DATABASE_URL;if(!u)throw new Error('no DATABASE_URL');const c=new Client({connectionString:u,ssl:{rejectUnauthorized:false}});await c.connect();await c.query(fs.readFileSync('/tmp/r-schema-b-residual.sql','utf8'));const r=await c.query(\\\"select to_regclass('nv_schema.nv_rag_coverage_audit')::text as rag, to_regclass('nv_schema.nv_bipa_consent_records')::text as bipa, to_regclass('nv_schema.nv_digital_twins')::text as twin, to_regclass('nv_schema.nv_biometric_artefacts')::text as bio\\\");console.log(JSON.stringify(r.rows[0]));await c.end();})().catch(e=>{console.error(e);process.exit(1);});\""]")"

echo "SSM apply=$CMD_ID"
for i in $(seq 1 24); do
  sleep 5
  ST="$(aws ssm get-command-invocation --command-id "$CMD_ID" --instance-id "$INSTANCE" --region "$REGION" --query Status --output text 2>/dev/null || echo Unknown)"
  echo "try=$i status=$ST"
  if [[ "$ST" != "Pending" && "$ST" != "InProgress" && "$ST" != "Delayed" ]]; then
    echo '--- stdout ---'
    aws ssm get-command-invocation --command-id "$CMD_ID" --instance-id "$INSTANCE" --region "$REGION" --query StandardOutputContent --output text
    echo '--- stderr ---'
    aws ssm get-command-invocation --command-id "$CMD_ID" --instance-id "$INSTANCE" --region "$REGION" --query StandardErrorContent --output text
    [[ "$ST" == "Success" ]]
    exit $?
  fi
done
echo "SSM timeout" >&2
exit 1
