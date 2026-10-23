#!/usr/bin/env bash
# Fetch graph ingest script from S3 and start background ingest loop on jrx-prod (via gateway container).
set -euo pipefail
mkdir -p /opt/nyv/logs
REGION="${JRX_AWS_REGION:-ap-south-1}"
BUCKET="${JRX_DEPLOY_BUCKET:-jrx-sdk-distribution}"
if ! aws s3 ls "s3://${BUCKET}/caselaw-worker/graph-edges/jrx-treatment-graph-ingest.mjs" --region "$REGION" >/dev/null 2>&1; then
  BUCKET="jurexio-sdk-devapp"
fi
HOST_SCRIPT="/opt/nyv/jrx-treatment-graph-ingest.mjs"
CONTAINER_SCRIPT="/tmp/jrx-treatment-graph-ingest.mjs"
LOG="/opt/nyv/logs/graph-ingest.log"
GATEWAY_CONTAINER="${JRX_GATEWAY_CONTAINER:-jrx-gateway}"

aws s3 cp "s3://${BUCKET}/caselaw-worker/graph-edges/jrx-treatment-graph-ingest.mjs" "$HOST_SCRIPT" --region "$REGION"

if docker exec "$GATEWAY_CONTAINER" pgrep -f "./jrx-treatment-graph-ingest.mjs" >/dev/null 2>&1; then
  echo "SKIP graph-ingest — already running in $GATEWAY_CONTAINER"
  exit 0
fi

docker cp "$HOST_SCRIPT" "${GATEWAY_CONTAINER}:${CONTAINER_SCRIPT}"

# Do not source .env.production wholesale (contains unquoted special characters).
ENV_FILE="/opt/Jurexio/secrets/.env.production"
DB_URL="$(grep -m1 '^DATABASE_URL=' "$ENV_FILE" | cut -d= -f2- | sed 's/^"//;s/"$//')"
DEPLOY_BUCKET="$(grep -m1 '^JRX_DEPLOY_BUCKET=' "$ENV_FILE" | cut -d= -f2- | sed 's/^"//;s/"$//' || true)"
AWS_KEY="$(grep -m1 '^AWS_ACCESS_KEY_ID=' "$ENV_FILE" | cut -d= -f2- | sed 's/^"//;s/"$//')"
AWS_SECRET="$(grep -m1 '^AWS_SECRET_ACCESS_KEY=' "$ENV_FILE" | cut -d= -f2- | sed 's/^"//;s/"$//')"

docker exec -d "$GATEWAY_CONTAINER" env \
  DATABASE_URL="$DB_URL" \
  JRX_DEPLOY_BUCKET="${DEPLOY_BUCKET:-jrx-sdk-distribution}" \
  JRX_AWS_REGION="$REGION" \
  AWS_ACCESS_KEY_ID="$AWS_KEY" \
  AWS_SECRET_ACCESS_KEY="$AWS_SECRET" \
  GRAPH_INGEST_POLL_MS=120000 \
  sh -c "node ${CONTAINER_SCRIPT} >> ${LOG} 2>&1"

echo "START graph-ingest in ${GATEWAY_CONTAINER} log=${LOG} bucket=${BUCKET}"
