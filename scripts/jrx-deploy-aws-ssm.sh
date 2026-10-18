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
: "${JRX_SSM_TIMEOUT_SECONDS:=7200}"
: "${JRX_SSM_POLL_INTERVAL_SEC:=5}"
JRX_SSM_POLL_MAX_ITER="$(( (JRX_SSM_TIMEOUT_SECONDS + JRX_SSM_POLL_INTERVAL_SEC - 1) / JRX_SSM_POLL_INTERVAL_SEC + 12 ))"

if [ "$JRX_EC2_INSTANCE_ID" = "i-0df71e5ea1df8f588" ]; then
  echo "Refusing deploy to Jurexio jrx-prod instance." >&2
  exit 3
fi

command -v aws >/dev/null 2>&1 || { echo "aws cli not installed" >&2; exit 1; }

jrx_ssm_run() {
  local phase_label="$1"
  local remote_script="$2"
  local encoded
  encoded="$(nv_b64_encode "$remote_script")"
  local cmd_id
  cmd_id="$(aws ssm send-command \
    --region "$JRX_AWS_REGION" \
    --instance-ids "$JRX_EC2_INSTANCE_ID" \
    --document-name AWS-RunShellScript \
    --timeout-seconds "$JRX_SSM_TIMEOUT_SECONDS" \
    --comment "jrx-deploy-aws-ssm ${DEPLOY_ID} ${phase_label}" \
    --parameters "commands=[\"echo ${encoded} | base64 -d | bash\"]" \
    --query Command.CommandId --output text)"
  echo "==> SSM phase=${phase_label} command_id=${cmd_id} (timeout=${JRX_SSM_TIMEOUT_SECONDS}s)"
  local status="Pending"
  local _i
  for _i in $(seq 1 "$JRX_SSM_POLL_MAX_ITER"); do
    status="$(aws ssm get-command-invocation \
      --region "$JRX_AWS_REGION" \
      --command-id "$cmd_id" \
      --instance-id "$JRX_EC2_INSTANCE_ID" \
      --query 'Status' --output text 2>/dev/null || echo Pending)"
    case "$status" in
      Success) echo "    SSM ${phase_label} Success"; break ;;
      Failed|Cancelled|TimedOut) echo "    SSM ${phase_label} ${status}"; break ;;
      *) sleep "$JRX_SSM_POLL_INTERVAL_SEC" ;;
    esac
  done
  echo "==> Stdout (${phase_label}):"
  aws ssm get-command-invocation --region "$JRX_AWS_REGION" \
    --command-id "$cmd_id" --instance-id "$JRX_EC2_INSTANCE_ID" \
    --query 'StandardOutputContent' --output text || true
  if [ "$status" != "Success" ]; then
    echo "==> Stderr (${phase_label}):"
    aws ssm get-command-invocation --region "$JRX_AWS_REGION" \
      --command-id "$cmd_id" --instance-id "$JRX_EC2_INSTANCE_ID" \
      --query 'StandardErrorContent' --output text || true
    return 1
  fi
  return 0
}

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
REMOTE_PHASE_BUILD="$(cat <<EOS
set -euo pipefail
DEPLOY_ID="${DEPLOY_ID}"
SHA="${SHA}"
DEPLOY_ROOT="${JRX_DEPLOY_ROOT}"
SECRETS="${JRX_SECRETS_FILE}"
LIVE_DIR="\${DEPLOY_ROOT}/repo/\${DEPLOY_ID}-\${SHA}"
COMPOSE="${JRX_COMPOSE_FILE}"
STATE="\${DEPLOY_ROOT}/.deploy-state-\${DEPLOY_ID}-\${SHA}"

mkdir -p "\${DEPLOY_ROOT}/repo" "\$(dirname "\${SECRETS}")"
aws s3 cp "s3://${JRX_DEPLOY_BUCKET}/${S3_KEY}" /tmp/jrx-deploy.tgz --region ${JRX_AWS_REGION}
rm -rf "\${LIVE_DIR}" && mkdir -p "\${LIVE_DIR}"
tar -xzf /tmp/jrx-deploy.tgz -C "\${LIVE_DIR}"
cd "\${LIVE_DIR}"

if [ -f "\${SECRETS}" ]; then
  cp "\${SECRETS}" .env
  echo "[jrx-ec2] phase=build overlaid secrets from \${SECRETS} (length \$(wc -c < .env) bytes)"
else
  echo "[jrx-ec2] phase=build WARN missing \${SECRETS} — gateway may fail until SSM bootstrap"
fi

echo "[jrx-ec2] phase=build docker compose build --pull gateway"
docker compose -f "\${COMPOSE}" build --pull gateway
printf '%s\n' "\${LIVE_DIR}" > "\${STATE}"
echo "[jrx-ec2] phase=build complete live_dir=\${LIVE_DIR}"
EOS
)"

REMOTE_PHASE_UP="$(cat <<EOS
set -euo pipefail
DEPLOY_ID="${DEPLOY_ID}"
SHA="${SHA}"
DEPLOY_ROOT="${JRX_DEPLOY_ROOT}"
LIVE_DIR="\${DEPLOY_ROOT}/repo/\${DEPLOY_ID}-\${SHA}"
COMPOSE="${JRX_COMPOSE_FILE}"
NOTE="\$(printf '%s' '${NOTE_B64}' | base64 -d 2>/dev/null || true)"
STATE="\${DEPLOY_ROOT}/.deploy-state-\${DEPLOY_ID}-\${SHA}"

if [ -f "\${STATE}" ]; then
  LIVE_DIR="\$(cat "\${STATE}")"
fi
cd "\${LIVE_DIR}"

if docker ps -a --format '{{.Names}}' | grep -qx 'jrx-gateway'; then
  echo "[jrx-ec2] phase=up removing stale container jrx-gateway"
  docker rm -f jrx-gateway 2>/dev/null || true
fi

echo "[jrx-ec2] phase=up docker compose up gateway"
docker compose -f "\${COMPOSE}" up -d --no-deps --force-recreate --remove-orphans gateway

HEALTH_OK=0
for i in \$(seq 1 30); do
  if wget -qO- http://127.0.0.1:5000/api/jrx/health >/dev/null 2>&1; then
    echo "[jrx-ec2] phase=up health OK"
    HEALTH_OK=1
    break
  fi
  sleep 3
done
if [ "\${HEALTH_OK}" != "1" ]; then
  echo "[jrx-ec2] phase=up health FAILED after 90s" >&2
  exit 1
fi

echo "\${DEPLOY_ID} \${SHA} \$(date -u +%Y-%m-%dT%H:%M:%SZ) \${NOTE}" >> "\${DEPLOY_ROOT}/deploys.log"
ln -sfn "\${LIVE_DIR}" "\${DEPLOY_ROOT}/current"
rm -f "\${STATE}"
echo "[jrx-ec2] phase=up complete"
EOS
)"

echo "==> [3/4] SSM phase build (timeout=${JRX_SSM_TIMEOUT_SECONDS}s)"
if ! jrx_ssm_run build "$REMOTE_PHASE_BUILD"; then
  echo "==> JRX deploy FAILED deploy_id=${DEPLOY_ID} phase=build" >&2
  exit 1
fi

echo "==> [4/4] SSM phase compose+health"
if ! jrx_ssm_run up "$REMOTE_PHASE_UP"; then
  echo "==> JRX deploy FAILED deploy_id=${DEPLOY_ID} phase=up" >&2
  exit 1
fi

mkdir -p "$ROOT/.local"
echo "${DEPLOY_ID} ${SHA} instance=${JRX_EC2_INSTANCE_ID}" >> "$ROOT/.local/jrx-deploys.log"
echo "==> JRX deploy finished deploy_id=${DEPLOY_ID}"
