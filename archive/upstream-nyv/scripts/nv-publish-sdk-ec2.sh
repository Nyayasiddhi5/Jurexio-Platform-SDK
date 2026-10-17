#!/usr/bin/env bash
# Upload sdk-dist/v5.0.0 to S3 and sync to EC2 /opt/Nyayavigya/sdk-dist/v5.0.0/
set -euo pipefail

nv_b64_encode() {
  if printf '' | base64 -w0 >/dev/null 2>&1; then
    printf '%s' "$1" | base64 -w0
  else
    printf '%s' "$1" | base64 | tr -d '\n'
  fi
}

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$APP_ROOT/scripts/jrx-source-dev-deploy-env.sh"

SDK_VERSION="${NYV_SDK_DIST_VERSION:-$(node -p "require('./packages/client-sdk/package.json').version")}"
DIST_DIR="$APP_ROOT/sdk-dist/v${SDK_VERSION}"
S3_PREFIX="s3://${NYV_DEPLOY_BUCKET}/sdk-dist/v${SDK_VERSION}"
BUCKET="${NYV_DEPLOY_BUCKET}"

if [[ ! -d "$DIST_DIR" ]] || ! compgen -G "$DIST_DIR/*.tgz" >/dev/null; then
  echo "missing tarballs — run: npm run publish:sdk:dist" >&2
  exit 1
fi

command -v aws >/dev/null 2>&1 || { echo "aws cli required" >&2; exit 1; }

echo "[sdk-ec2] uploading ${DIST_DIR} -> ${S3_PREFIX}/"
aws s3 sync "$DIST_DIR/" "$S3_PREFIX/" --exclude '.DS_Store' --delete

SCRIPT=$(mktemp)
cat > "$SCRIPT" <<EOS
set -euo pipefail
SDK_VER="${SDK_VERSION}"
BUCKET="${BUCKET}"
BASE="/opt/Nyayavigya/sdk-dist"
TARGET="\${BASE}/v\${SDK_VER}"
ARCHIVE="\${BASE}/_archive"
mkdir -p "\${TARGET}" "\${ARCHIVE}" "\${BASE}/current"
for old in \${BASE}/v*; do
  [[ -d "\$old" ]] || continue
  [[ "\$old" == "\${TARGET}" ]] && continue
  ts=\$(date -u +%Y%m%dT%H%M%SZ)
  mv "\$old" "\${ARCHIVE}/\$(basename "\$old")-\${ts}" 2>/dev/null || true
done
aws s3 sync "s3://\${BUCKET}/sdk-dist/v\${SDK_VER}/" "\${TARGET}/" --exclude '.DS_Store'
ln -sfn "v\${SDK_VER}" "\${BASE}/current"
echo "[ec2] sdk-dist synced -> \${TARGET}"
ls -1 "\${TARGET}/"*.tgz 2>/dev/null | wc -l | xargs echo "[ec2] tarball count:"
EOS

B64="$(nv_b64_encode "$(cat "$SCRIPT")")"
rm -f "$SCRIPT"

CMD_ID=$(aws ssm send-command \
  --region "$NYV_AWS_REGION" \
  --instance-ids "$NYV_EC2_INSTANCE_ID" \
  --document-name AWS-RunShellScript \
  --comment "sdk-dist-sync-v${SDK_VERSION}" \
  --parameters "commands=[\"echo ${B64} | base64 -d | bash\"]" \
  --query Command.CommandId --output text)

echo "[sdk-ec2] SSM ${CMD_ID} - waiting..."
st=Pending
for _ in $(seq 1 60); do
  st=$(aws ssm get-command-invocation --region "$NYV_AWS_REGION" --command-id "$CMD_ID" \
    --instance-id "$NYV_EC2_INSTANCE_ID" --query Status --output text 2>/dev/null || echo Pending)
  case "$st" in Success|Failed|Cancelled|TimedOut) break ;; *) sleep 2 ;; esac
done

aws ssm get-command-invocation --region "$NYV_AWS_REGION" --command-id "$CMD_ID" \
  --instance-id "$NYV_EC2_INSTANCE_ID" --query '[Status,StandardOutputContent,StandardErrorContent]' --output text

[[ "$st" == Success ]] || exit 1
echo "[sdk-ec2] DONE - EC2 /opt/Nyayavigya/sdk-dist/v${SDK_VERSION}"
