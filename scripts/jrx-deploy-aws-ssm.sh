#!/usr/bin/env bash
# JRX-DEPLOY-001 — Jurexio EC2 deploy via SSM (mirrors JRX deploy-aws-ssm; separate host + paths).
set -euo pipefail

nv_b64_encode() {
  if printf '' | base64 -w0 >/dev/null 2>&1; then
    printf '%s' "$1" | base64 -w0
  else
    printf '%s' "$1" | base64 | tr -d '\n'
  fi
}

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DRY_RUN=0
NOTE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --note)    NOTE="${2:-}"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

: "${AWS_ACCESS_KEY_ID:?missing AWS_ACCESS_KEY_ID (use env.production.jurexio)}"
: "${AWS_SECRET_ACCESS_KEY:?missing AWS_SECRET_ACCESS_KEY}"
: "${JRX_EC2_INSTANCE_ID:?missing JRX_EC2_INSTANCE_ID — must NOT be jrx-prod i-0df71e5ea1df8f588}"
: "${JRX_AWS_REGION:=ap-south-1}"
: "${JRX_DEPLOY_BUCKET:=jurexio-deploy-artifacts}"
: "${JRX_DEPLOY_ROOT:=/opt/Jurexio}"
: "${JRX_SECRETS_FILE:=/opt/Jurexio/secrets/.env.production}"
: "${JRX_COMPOSE_FILE:=docker-compose.jurexio-aws.yml}"

if [ "$JRX_EC2_INSTANCE_ID" = "i-0df71e5ea1df8f588" ]; then
  echo "Refusing deploy to Jurexio jrx-prod instance." >&2
  exit 3
fi

command -v aws >/dev/null 2>&1 || { echo "aws cli not installed" >&2; exit 1; }

DEPLOY_ID="$(date -u +%Y-%m-%dT%H%MZ)-jrx-aws-ssm"
SHA="$(git --no-optional-locks rev-parse --short=8 HEAD 2>/dev/null || echo nogit)"
TARBALL="/tmp/jrx-${DEPLOY_ID}-${SHA}.tgz"

echo "==> [1/4] Building tarball ${TARBALL}"
tar --exclude='.git' --exclude='node_modules' --exclude='dist' \
    --exclude='archive' --exclude='.local' --exclude='graphify-out' \
    --exclude='.env' --exclude='.env.local' \
    --exclude='client/dist' --exclude='coverage' \
    -czf "$TARBALL" .
echo "    tarball size: $(du -h "$TARBALL" | awk '{print $1}')"

S3_KEY="jrx/deploys/${DEPLOY_ID}-${SHA}.tgz"
echo "==> [2/4] Upload s3://${JRX_DEPLOY_BUCKET}/${S3_KEY}"
aws s3 cp --region "$JRX_AWS_REGION" "$TARBALL" "s3://${JRX_DEPLOY_BUCKET}/${S3_KEY}" --only-show-errors

if [ "$DRY_RUN" = "1" ]; then
  echo "==> --dry-run complete deploy_id=${DEPLOY_ID} sha=${SHA}"
  exit 0
fi

NOTE_B64="$(nv_b64_encode "$NOTE")"
REMOTE_SCRIPT="$(cat <<EOS
set -euo pipefail
DEPLOY_ID="${DEPLOY_ID}"
SHA="${SHA}"
DEPLOY_ROOT="${JRX_DEPLOY_ROOT}"
SECRETS="${JRX_SECRETS_FILE}"
LIVE_DIR="\${DEPLOY_ROOT}/repo/\${DEPLOY_ID}-\${SHA}"
COMPOSE="${JRX_COMPOSE_FILE}"
NOTE="\$(printf '%s' '${NOTE_B64}' | base64 -d 2>/dev/null || true)"

mkdir -p "\${DEPLOY_ROOT}/repo" "\$(dirname "\${SECRETS}")"
aws s3 cp "s3://${JRX_DEPLOY_BUCKET}/${S3_KEY}" /tmp/jrx-deploy.tgz --region ${JRX_AWS_REGION}
rm -rf "\${LIVE_DIR}" && mkdir -p "\${LIVE_DIR}"
tar -xzf /tmp/jrx-deploy.tgz -C "\${LIVE_DIR}"
cd "\${LIVE_DIR}"

if [ -f "\${SECRETS}" ]; then
  cp "\${SECRETS}" .env
  echo "[jrx-ec2] overlaid secrets from \${SECRETS} (length \$(wc -c < .env) bytes)"
else
  echo "[jrx-ec2] WARN missing \${SECRETS} — gateway may fail until SSM bootstrap"
fi

docker compose -f "\${COMPOSE}" build --pull gateway

if docker ps -a --format '{{.Names}}' | grep -qx 'jrx-gateway'; then
  echo "[jrx-ec2] removing stale container jrx-gateway (pre compose up)"
  docker rm -f jrx-gateway 2>/dev/null || true
fi

docker compose -f "\${COMPOSE}" up -d --no-deps --force-recreate --remove-orphans gateway

HEALTH_OK=0
for i in \$(seq 1 30); do
  if wget -qO- http://127.0.0.1:5000/api/jrx/health >/dev/null 2>&1; then
    echo "[jrx-ec2] health OK"
    HEALTH_OK=1
    break
  fi
  sleep 3
done
if [ "\${HEALTH_OK}" != "1" ]; then
  echo "[jrx-ec2] health FAILED after 90s" >&2
  exit 1
fi

echo "\${DEPLOY_ID} \${SHA} \$(date -u +%Y-%m-%dT%H:%M:%SZ) \${NOTE}" >> "\${DEPLOY_ROOT}/deploys.log"
ln -sfn "\${LIVE_DIR}" "\${DEPLOY_ROOT}/current"
EOS
)"

ENCODED="$(nv_b64_encode "$REMOTE_SCRIPT")"
CMD_ID="$(aws ssm send-command \
  --region "$JRX_AWS_REGION" \
  --instance-ids "$JRX_EC2_INSTANCE_ID" \
  --document-name AWS-RunShellScript \
  --parameters "commands=[\"echo ${ENCODED} | base64 -d | bash\"]" \
  --query Command.CommandId --output text)"

echo "==> [3/4] SSM command_id=${CMD_ID}"
echo "==> [4/4] Waiting for SSM completion (max 15min)"
SSM_STATUS="Pending"
for _i in $(seq 1 180); do
  SSM_STATUS="$(aws ssm get-command-invocation \
    --region "$JRX_AWS_REGION" \
    --command-id "$CMD_ID" \
    --instance-id "$JRX_EC2_INSTANCE_ID" \
    --query 'Status' --output text 2>/dev/null || echo Pending)"
  case "$SSM_STATUS" in
    Success) echo "    SSM Success"; break ;;
    Failed|Cancelled|TimedOut) echo "    SSM ${SSM_STATUS}"; break ;;
    *) sleep 5 ;;
  esac
done

echo "==> Stdout:"
aws ssm get-command-invocation --region "$JRX_AWS_REGION" \
  --command-id "$CMD_ID" --instance-id "$JRX_EC2_INSTANCE_ID" \
  --query 'StandardOutputContent' --output text || true

if [ "$SSM_STATUS" != "Success" ]; then
  echo "==> Stderr:"
  aws ssm get-command-invocation --region "$JRX_AWS_REGION" \
    --command-id "$CMD_ID" --instance-id "$JRX_EC2_INSTANCE_ID" \
    --query 'StandardErrorContent' --output text || true
  echo "==> JRX deploy FAILED deploy_id=${DEPLOY_ID} ssm_status=${SSM_STATUS}" >&2
  exit 1
fi

mkdir -p "$ROOT/.local"
echo "${DEPLOY_ID} ${SHA} instance=${JRX_EC2_INSTANCE_ID}" >> "$ROOT/.local/jrx-deploys.log"
echo "==> JRX deploy finished deploy_id=${DEPLOY_ID}"
