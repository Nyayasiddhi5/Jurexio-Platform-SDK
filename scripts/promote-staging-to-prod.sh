#!/usr/bin/env bash
# =============================================================================
# promote-staging-to-prod.sh — zero-downtime promotion of a staging-tested
# image into production.
#
# Workflow:
#   1. Validate the source tag exists in ECR.
#   2. Re-tag the staging image as `prod-<sha>` and `prod` and `latest` in ECR
#      (atomic; ECR lifecycle keeps prod/staging/latest forever).
#   3. SSH to the prod EC2 host.
#   4. Pull the new prod tag.
#   5. Recreate gateway-b first; wait health; recreate gateway-a; wait health.
#   6. Update CURRENT_DEPLOY + LAST_GOOD_DEPLOY tracking files.
#
# Usage:
#   bash scripts/promote-staging-to-prod.sh <staging-tag>
#   bash scripts/promote-staging-to-prod.sh staging-7f3a9b2c
#   bash scripts/promote-staging-to-prod.sh staging          # promote current `staging` tag
# =============================================================================
set -euo pipefail

SRC_TAG="${1:-}"
[ -n "$SRC_TAG" ] || { echo "usage: $0 <ecr-image-tag>" >&2; exit 2; }

REGION="${AWS_REGION:-ap-south-1}"
ACCOUNT="${NYV_ACCOUNT_ID:-789925699169}"
REGISTRY="${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com"
SSH_KEY="${NYV_DEPLOY_SSH_KEY:-.local/keys/nysdev.pem}"
HOST="${NYV_DEPLOY_HOST:-13.232.165.242}"
USER_R="${NYV_DEPLOY_USER:-ubuntu}"
REPO_DIR="${NYV_DEPLOY_REMOTE_DIR:-/opt/nyayavigya/repo/nyayavigya-platform-312}"
COMPOSE="docker-compose.ecosystem.yml"
HEALTH_URL="http://127.0.0.1:5000/health"

LOG()  { printf "[promote %s] %s\n" "$(date -u +%H:%M:%S)" "$*"; }
DIE()  { printf "FATAL: %s\n" "$*" >&2; exit 1; }

[ -f "$SSH_KEY" ] || DIE "SSH key $SSH_KEY not found"
chmod 600 "$SSH_KEY" 2>/dev/null || true
SSH_OPTS=(-i "$SSH_KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15)

# 1. Validate source ----------------------------------------------------------
LOG "Verifying $REGISTRY/nyv-gateway:$SRC_TAG exists"
aws ecr describe-images --region "$REGION" --repository-name nyv-gateway \
    --image-ids imageTag="$SRC_TAG" >/dev/null \
    || DIE "Source tag nyv-gateway:$SRC_TAG not found in ECR"

# 2. Re-tag in ECR (manifest copy) -------------------------------------------
SHA=$(aws ecr describe-images --region "$REGION" --repository-name nyv-gateway \
        --image-ids imageTag="$SRC_TAG" --query 'imageDetails[0].imageDigest' --output text)
NEW_TAG="prod-$(date -u +%Y%m%dT%H%M%SZ)"
LOG "Re-tagging digest $SHA  ->  prod, latest, $NEW_TAG"

MANIFEST=$(aws ecr batch-get-image --region "$REGION" --repository-name nyv-gateway \
            --image-ids imageTag="$SRC_TAG" \
            --query 'images[0].imageManifest' --output text)
for tag in "prod" "latest" "$NEW_TAG"; do
  aws ecr put-image --region "$REGION" --repository-name nyv-gateway \
      --image-tag "$tag" --image-manifest "$MANIFEST" >/dev/null 2>&1 || \
      LOG "  (tag $tag may already point to this digest — continuing)"
done

# 3..6 — rolling restart on prod EC2 -----------------------------------------
LOG "Recreating gateway-b on $HOST"
ssh "${SSH_OPTS[@]}" "$USER_R@$HOST" "
  set -e
  cd $REPO_DIR
  sg docker -c 'aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $REGISTRY'
  sg docker -c 'docker compose -f $COMPOSE --env-file .env pull gateway-b'
  sg docker -c 'docker compose -f $COMPOSE --env-file .env up -d --no-deps --force-recreate gateway-b'
  for i in \$(seq 1 24); do
    code=\$(sg docker -c \"docker exec nyv-gateway-b wget -q -O - $HEALTH_URL 2>/dev/null | head -c 30\")
    if echo \"\$code\" | grep -q ok; then echo 'gateway-b healthy'; exit 0; fi
    sleep 5
  done
  echo 'gateway-b never became healthy' >&2
  exit 1
" || DIE "gateway-b promotion failed — gateway-a still serving prod traffic; investigate before retrying"

LOG "gateway-b is healthy. Recreating gateway-a..."
ssh "${SSH_OPTS[@]}" "$USER_R@$HOST" "
  set -e
  cd $REPO_DIR
  sg docker -c 'docker compose -f $COMPOSE --env-file .env pull gateway-a'
  sg docker -c 'docker compose -f $COMPOSE --env-file .env up -d --no-deps --force-recreate gateway-a'
  for i in \$(seq 1 24); do
    code=\$(sg docker -c \"docker exec nyv-gateway-a wget -q -O - $HEALTH_URL 2>/dev/null | head -c 30\")
    if echo \"\$code\" | grep -q ok; then echo 'gateway-a healthy'; exit 0; fi
    sleep 5
  done
  echo 'gateway-a never became healthy' >&2
  exit 1
" || DIE "gateway-a promotion failed — gateway-b is still serving prod traffic; rollback by re-tagging the previous prod-* tag and re-running this script"

LOG "Updating CURRENT_DEPLOY + LAST_GOOD_DEPLOY"
ssh "${SSH_OPTS[@]}" "$USER_R@$HOST" "
  printf '%s\n%s\nfrom-promote\n' '$NEW_TAG' '$(date -u +%FT%TZ)' | sudo tee /opt/nyayavigya/CURRENT_DEPLOY > /dev/null
  printf '%s\n%s\nfrom-promote\n' '$NEW_TAG' '$(date -u +%FT%TZ)' | sudo tee /opt/nyayavigya/LAST_GOOD_DEPLOY > /dev/null
  echo '$(date -u +%FT%TZ) PROMOTE $NEW_TAG src=$SRC_TAG digest=$SHA' | sudo tee -a /opt/nyayavigya/logs/deploys.log > /dev/null
"

LOG "PROMOTE OK — prod is now serving $NEW_TAG  (digest $SHA)"
