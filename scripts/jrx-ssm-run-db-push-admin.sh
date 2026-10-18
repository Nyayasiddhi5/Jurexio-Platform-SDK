#!/usr/bin/env bash
# JRX-SSM-DB-PUSH-001 — run Drizzle push on Jurexio EC2 via SSM using RDS *master* URL.
#
# Operator supplies credentials locally (never commit):
#   JRX_RDS_ADMIN_URL=postgres://<master>@<host>:5432/postgres?sslmode=verify-full
#   JRX_EC2_INSTANCE_ID=i-...
#   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
#
# Uses DATABASE_URL=JRX_RDS_ADMIN_URL (or app DB variant) for `npm run db:push -- --force`.
# Eyeball drizzle-kit diff output in SSM stdout before relying on --force in production.
#
# Optional: JRX_DEPLOY_ROOT=/opt/Jurexio  JRX_AWS_REGION=ap-south-1  --dry-run
set -euo pipefail

nv_b64_encode() {
  if printf '' | base64 -w0 >/dev/null 2>&1; then
    printf '%s' "$1" | base64 -w0
  else
    printf '%s' "$1" | base64 | tr -d '\n'
  fi
}

DRY_RUN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

: "${AWS_ACCESS_KEY_ID:?missing AWS_ACCESS_KEY_ID}"
: "${AWS_SECRET_ACCESS_KEY:?missing AWS_SECRET_ACCESS_KEY}"
: "${JRX_EC2_INSTANCE_ID:?missing JRX_EC2_INSTANCE_ID}"
: "${JRX_RDS_ADMIN_URL:?set JRX_RDS_ADMIN_URL locally (RDS master / postgres DB)}"

JRX_AWS_REGION="${JRX_AWS_REGION:-ap-south-1}"
JRX_DEPLOY_ROOT="${JRX_DEPLOY_ROOT:-/opt/Jurexio}"

if [ "$JRX_EC2_INSTANCE_ID" = "i-0df71e5ea1df8f588" ]; then
  echo "Refusing SSM db:push on Jurexio jrx-prod instance id." >&2
  exit 3
fi

echo "==> JRX SSM db:push admin URL length=${#JRX_RDS_ADMIN_URL} instance=${JRX_EC2_INSTANCE_ID}"

ADMIN_B64="$(nv_b64_encode "$JRX_RDS_ADMIN_URL")"
REMOTE_SCRIPT="$(cat <<EOS
set -euo pipefail
DEPLOY_ROOT="${JRX_DEPLOY_ROOT}"
LIVE="\${DEPLOY_ROOT}/current"
if [ ! -d "\${LIVE}" ]; then
  echo "[jrx-ec2] missing \${LIVE} — deploy first" >&2
  exit 1
fi
cd "\${LIVE}"
export DATABASE_URL="\$(printf '%s' '${ADMIN_B64}' | base64 -d)"
echo "[jrx-ec2] DATABASE_URL length \$(printf '%s' "\${DATABASE_URL}" | wc -c)"
if ! command -v npm >/dev/null 2>&1; then
  echo "[jrx-ec2] npm not on PATH — install Node or run from a host with repo tooling" >&2
  exit 1
fi
npm run db:push -- --force
echo "[jrx-ec2] db:push finished"
EOS
)"

if [ "$DRY_RUN" = "1" ]; then
  echo "==> --dry-run: would send SSM RunShellScript to ${JRX_EC2_INSTANCE_ID}"
  echo "    remote: cd ${JRX_DEPLOY_ROOT}/current && DATABASE_URL=<len ${#JRX_RDS_ADMIN_URL}> npm run db:push -- --force"
  exit 0
fi

ENCODED="$(nv_b64_encode "$REMOTE_SCRIPT")"
CMD_ID="$(aws ssm send-command \
  --region "$JRX_AWS_REGION" \
  --instance-ids "$JRX_EC2_INSTANCE_ID" \
  --document-name AWS-RunShellScript \
  --comment "jrx-ssm-run-db-push-admin" \
  --parameters "commands=[\"echo ${ENCODED} | base64 -d | bash\"]" \
  --query Command.CommandId --output text)"

echo "==> SSM command_id=${CMD_ID}"
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

aws ssm get-command-invocation --region "$JRX_AWS_REGION" \
  --command-id "$CMD_ID" --instance-id "$JRX_EC2_INSTANCE_ID" \
  --query 'StandardOutputContent' --output text || true

if [ "$SSM_STATUS" != "Success" ]; then
  aws ssm get-command-invocation --region "$JRX_AWS_REGION" \
    --command-id "$CMD_ID" --instance-id "$JRX_EC2_INSTANCE_ID" \
    --query 'StandardErrorContent' --output text || true
  exit 1
fi
