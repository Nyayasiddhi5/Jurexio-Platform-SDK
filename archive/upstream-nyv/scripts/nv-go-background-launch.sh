#!/usr/bin/env bash
# User GO launcher — deploy NYS body-FTS + start all background jobs (no long-running local work).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
source scripts/jrx-source-dev-deploy-env.sh

echo "==> [1/4] NYS upload + deploy API + worker scripts"
cd jrx-search/scripts
node upload-deploy.mjs --deploy --scripts

echo "==> [2/4] NYS worker — DDL + background jobs (newest-first, reverse chronological)"
cd "$ROOT"
bash scripts/_nys-ssm-run.sh scripts/_nys-go-background-jobs.sh "GO-sc-body-fts+citation-graph"

echo "==> [3/4] Upload graph-ingest script to S3 (both buckets)"
aws s3 cp scripts/jrx-treatment-graph-ingest.mjs \
  "s3://nyv-sdk-distribution/caselaw-worker/graph-edges/jrx-treatment-graph-ingest.mjs" \
  --region "${NYV_AWS_REGION:-ap-south-1}"
aws s3 cp scripts/jrx-treatment-graph-ingest.mjs \
  "s3://${NYV_DEPLOY_BUCKET}/caselaw-worker/graph-edges/jrx-treatment-graph-ingest.mjs" \
  --region "${NYV_AWS_REGION:-ap-south-1}"

echo "==> [4/4] NYV nysdev — start graph ingest loop (background)"
bash scripts/jrx-ec2-ssm-run.sh scripts/_nv-go-graph-ingest-from-s3.sh "GO-graph-ingest"

echo "DONE — all jobs running independently on EC2. Monitor:"
echo "  Worker logs: /opt/nyv/logs/{sc-body-fts,treatment-graph-extract,treatment-graph-edges}.log"
echo "  Nysdev log:  /opt/nyv/logs/graph-ingest.log"
echo "  Checkpoints: /opt/nyv/api/.{sc-body-fts,treatment-graph-extract,treatment-graph-edges}-checkpoint.json"
