#!/usr/bin/env bash
# ============================================================================
# Jurexio 3.1.2 / SDK 5.0.0 — ONE-CLICK DEPLOY ENTRY
# ============================================================================
# Usage:
#   bash scripts/one-click-deploy.sh <command>
#
# Commands:
#   preflight       Verify env vars + tools (no changes)
#   bootstrap-db    Apply schema + seed master data + load 1043 agents
#   build-images    Build gateway + console Docker images
#   push-images     Push to ECR (requires AWS_REGION + AWS_ACCOUNT_ID)
#   deploy-eks      Apply k8s manifests (requires kubectl + aws cli)
#   deploy-compose  Single-server docker-compose up
#   provision-sdk   Create the 5 Nyayasiddhi SDK apps + keys
#   smoke           Run live health + agent + orchestrate smoke tests
#   all             preflight -> bootstrap-db -> build-images -> push-images -> deploy-eks -> provision-sdk -> smoke
# ============================================================================

set -euo pipefail
cmd=${1:-help}
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

require_env() {
  local missing=()
  for v in "$@"; do
    if [[ -z "${!v:-}" ]]; then missing+=("$v"); fi
  done
  if [[ ${#missing[@]} -gt 0 ]]; then
    echo "ERROR: missing env vars: ${missing[*]}" >&2
    exit 1
  fi
}

case "$cmd" in
  preflight)
    echo "[preflight] checking required env vars and tools..."
    require_env DATABASE_URL JRX_JWT_SECRET JRX_JWT_REFRESH_SECRET JRX_REDIS_TCP_URL OPENROUTER_API_KEY
    for t in node pnpm psql; do command -v "$t" >/dev/null || { echo "missing $t"; exit 1; }; done
    echo "[preflight] config files:"
    for f in config/jrx-master-config.json config/rate-limits/rate-limits.json \
             config/platforms/platform-access-matrix.json config/llm/llm-config.json \
             config/memory/memory-config.json config/storage/storage-config.json \
             config/cache/cache-config.json config/security/security-config.json \
             config/integrations/integrations.json config/agents/agents-master.json; do
      test -f "$f" && echo "  OK  $f" || { echo "  MISSING $f"; exit 1; }
    done
    echo "[preflight] all good."
    ;;

  bootstrap-db)
    echo "[bootstrap-db] applying schema..."
    psql "$DATABASE_URL" -f scripts/jurexio-312-db-dump.sql
    echo "[bootstrap-db] running master seed (jurisdictions, statutes, LLM providers, MCP tools, agents)..."
    pnpm tsx scripts/jrx-seed-all.ts
    echo "[bootstrap-db] loading agent system prompts from config/agents/agents-master.json..."
    pnpm tsx scripts/jrx-seed-agents.ts --include-system-prompts --master config/agents/agents-master.json || true
    echo "[bootstrap-db] verifying..."
    psql "$DATABASE_URL" -c "SELECT COUNT(*) AS tables FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'nv_%';"
    psql "$DATABASE_URL" -c "SELECT COUNT(*) AS agents FROM nv_agents;"
    ;;

  build-images)
    require_env AWS_REGION AWS_ACCOUNT_ID
    echo "[build] gateway..."
    docker build -t jrx-gateway:3.1.2 -f Dockerfile.gateway .
    echo "[build] console..."
    docker build -t jrx-console:3.1.2 -f Dockerfile.console ./client
    ;;

  push-images)
    require_env AWS_REGION AWS_ACCOUNT_ID
    aws ecr get-login-password --region "$AWS_REGION" \
      | docker login --username AWS --password-stdin "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"
    for image in jrx-gateway jrx-console; do
      docker tag "$image:3.1.2" "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$image:3.1.2"
      docker push "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$image:3.1.2"
    done
    ;;

  deploy-eks)
    require_env AWS_REGION EKS_CLUSTER
    aws eks update-kubeconfig --region "$AWS_REGION" --name "$EKS_CLUSTER"
    kubectl create namespace nyayavigya --dry-run=client -o yaml | kubectl apply -f -
    kubectl -n nyayavigya apply -f deploy/k8s/
    kubectl -n nyayavigya rollout status deployment/jrx-gateway --timeout=10m
    kubectl -n nyayavigya rollout status deployment/jrx-console --timeout=10m
    ;;

  deploy-compose)
    docker compose -f deploy/docker-compose.yml up -d --build
    ;;

  provision-sdk)
    echo "[provision-sdk] creating SDK apps for the 5 Nyayasiddhi platforms..."
    pnpm tsx scripts/jrx-provision-ecosystem.ts \
      --matrix config/platforms/platform-access-matrix.json
    ;;

  smoke)
    BASE="${JRX_BASE_URL:-http://localhost:5000}"
    echo "[smoke] /health"
    curl -fsS "$BASE/health" | head -c 200; echo
    echo "[smoke] /api/jrx/health"
    curl -fsS "$BASE/api/jrx/health" | head -c 400; echo
    echo "[smoke] /api/jrx/docs/swagger.json (HEAD)"
    curl -fsS -o /dev/null -w "%{http_code}\n" "$BASE/api/jrx/docs/swagger.json"
    echo "[smoke] /api/jrx/orchestrate (auth required)"
    curl -fsS -o /dev/null -w "%{http_code}\n" "$BASE/api/jrx/orchestrate" -X POST -H 'Content-Type: application/json' -d '{}' || true
    ;;

  all)
    bash "$0" preflight
    bash "$0" bootstrap-db
    bash "$0" build-images
    bash "$0" push-images
    bash "$0" deploy-eks
    bash "$0" provision-sdk
    bash "$0" smoke
    ;;

  *)
    echo "Usage: bash scripts/one-click-deploy.sh {preflight|bootstrap-db|build-images|push-images|deploy-eks|deploy-compose|provision-sdk|smoke|all}"
    exit 1
    ;;
esac

echo "[one-click-deploy] '$cmd' done."
