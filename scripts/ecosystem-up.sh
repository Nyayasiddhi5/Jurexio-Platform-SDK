#!/usr/bin/env bash
# =============================================================================
# ecosystem-up.sh — boot the whole prod stack on a host that already has the
# repo synced + .env ready + ECR login in place.  Idempotent.
# =============================================================================
set -euo pipefail

REGION="${AWS_REGION:-ap-south-1}"
ACCOUNT="${JRX_ACCOUNT_ID:-789925699169}"
REGISTRY="${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com"
COMPOSE="${JRX_COMPOSE:-docker-compose.ecosystem.yml}"
ENV_FILE="${JRX_ENV_FILE:-.env}"
HEALTH_URL="http://127.0.0.1/health"

cd "$(dirname "$0")/.."

if ! sg docker -c 'docker info' >/dev/null 2>&1; then
  echo "Docker not running or user not in 'docker' group" >&2; exit 1
fi

echo "[ecosystem-up] ECR login"
aws ecr get-login-password --region "$REGION" \
  | sg docker -c "docker login --username AWS --password-stdin $REGISTRY"

echo "[ecosystem-up] pulling images"
sg docker -c "docker compose -f $COMPOSE --env-file $ENV_FILE pull"

echo "[ecosystem-up] up -d"
sg docker -c "docker compose -f $COMPOSE --env-file $ENV_FILE up -d"

echo "[ecosystem-up] waiting for /health on Caddy edge (up to 120s)"
for i in $(seq 1 24); do
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 5 "$HEALTH_URL" || echo 000)
  if [ "$code" = "200" ]; then echo "[ecosystem-up] OK"; exit 0; fi
  printf "  [%2ds] %s\n" $((i*5)) "$code"
  sleep 5
done

echo "[ecosystem-up] FAIL — health never returned 200" >&2
exit 1
