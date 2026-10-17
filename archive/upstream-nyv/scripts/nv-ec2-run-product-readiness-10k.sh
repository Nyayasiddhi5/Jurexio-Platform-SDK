#!/usr/bin/env bash
# Push latest readiness script to EC2 container and run product-readiness-10k gate.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/scripts/jrx-source-dev-deploy-env.sh"

encode_file() {
  if base64 -w0 "$1" >/dev/null 2>&1; then base64 -w0 "$1"; else base64 < "$1" | tr -d '\n'; fi
}

READINESS_B64=$(encode_file "$ROOT/scripts/jrx-product-readiness-10k.ts")
SEED_B64=$(encode_file "$ROOT/scripts/jrx-seed-uat-platform-users.ts")

read -r -d '' REMOTE <<EOF || true
set -euo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
read_env() { grep -E "^\${1}=" "\$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n'; }
NV_DEMO_PW="\$(read_env NV_DEMO_PASSWORD)"
BUCKET="\${NYV_DEPLOY_BUCKET:-nyayavigya-sdk-devapp}"
REGION="\${NYV_AWS_REGION:-ap-south-1}"
export GATEWAY="https://api.nyayasiddhi.online"
export CONSOLE_URL="https://console.nyayasiddhi.online"
export UAT_ADMIN_EMAIL="admin@nyayavigya.in"
export UAT_ADMIN_PASSWORD="\$NV_DEMO_PW"
export UAT_SME_EMAIL="legalchat-sme-a-uat@nyayavigya.in"
export UAT_SME_PASSWORD="\$NV_DEMO_PW"
export NYV_SDK_KEY_NSP="\$(read_env NYV_SDK_KEY_NSP)"
export NYV_SDK_KEY_SHARED="\$NYV_SDK_KEY_NSP"
export NYV_SDK_SHARED_KEYS=1
export NYV_SDK_KEY_NSI="\$NYV_SDK_KEY_NSP"
export NYV_SDK_KEY_NYM="\$NYV_SDK_KEY_NSP"
export NYV_SDK_KEY_NSA="\$NYV_SDK_KEY_NSP"
export NYV_SDK_KEY_NSM="\$NYV_SDK_KEY_NSP"
export NYV_SDK_KEY_NSPM="\$NYV_SDK_KEY_NSP"
export NYV_SDK_KEY_JRX="\$NYV_SDK_KEY_NSP"
echo "NSP key present: \$([ -n "\$NYV_SDK_KEY_NSP" ] && echo yes || echo no)"
mkdir -p /tmp/jrx-readiness
echo '$READINESS_B64' | base64 -d > /tmp/jrx-readiness/jrx-product-readiness-10k.ts
echo '$SEED_B64' | base64 -d > /tmp/jrx-readiness/jrx-seed-uat-platform-users.ts
docker cp /tmp/jrx-readiness/jrx-product-readiness-10k.ts nyv-gateway:/app/scripts/jrx-product-readiness-10k.ts
docker cp /tmp/jrx-readiness/jrx-seed-uat-platform-users.ts nyv-gateway:/app/scripts/jrx-seed-uat-platform-users.ts
docker exec -e NV_DEMO_PASSWORD="\$NV_DEMO_PW" -e NV_UAT_ADMIN_PASSWORD="\$NV_DEMO_PW" -e NV_UAT_SME_PASSWORD="\$NV_DEMO_PW" -w /app nyv-gateway npx tsx scripts/jrx-seed-uat-platform-users.ts 2>&1 | tail -6
TMP="/tmp/jrx-readiness-nda.txt"
printf '%s\n' 'MUTUAL NON-DISCLOSURE AGREEMENT (UAT fixture)' 'Parties: Nyayavigya Platform UAT' > "\$TMP"
S3_KEY="product-readiness/\$(date -u +%F)/sample-nda-\$(date +%s).txt"
aws s3 cp "\$TMP" "s3://\${BUCKET}/\${S3_KEY}" --region "\$REGION" --content-type text/plain
export PRODUCT_READINESS_PRESIGNED_URL="\$(aws s3 presign "s3://\${BUCKET}/\${S3_KEY}" --expires-in 3600 --region "\$REGION")"
export PRODUCT_READINESS_S3_KEY="\$S3_KEY"
docker exec nyv-gateway mkdir -p /app/tests/fixtures/product-readiness
docker cp "\$TMP" nyv-gateway:/app/tests/fixtures/product-readiness/sample-nda.txt
docker exec -e GATEWAY -e CONSOLE_URL -e UAT_ADMIN_EMAIL -e UAT_ADMIN_PASSWORD -e UAT_SME_EMAIL -e UAT_SME_PASSWORD \\
  -e NYV_SDK_KEY_NSP -e NYV_SDK_KEY_NSI -e NYV_SDK_KEY_NYM -e NYV_SDK_KEY_NSA -e NYV_SDK_KEY_NSM \\
  -e NYV_SDK_KEY_NSPM -e NYV_SDK_KEY_JRX -e NYV_SDK_KEY_SHARED -e NYV_SDK_SHARED_KEYS \\
  -e PRODUCT_READINESS_PRESIGNED_URL -e PRODUCT_READINESS_S3_KEY -e NYV_DEPLOY_BUCKET="\$BUCKET" -e NYV_AWS_REGION="\$REGION" \\
  -w /app nyv-gateway npx tsx scripts/jrx-product-readiness-10k.ts 2>&1 | tee /tmp/jrx-readiness-out.txt | tail -90
# Pull report if present
docker cp nyv-gateway:/app/uat-reports/. /tmp/jrx-readiness-reports/ 2>/dev/null || true
ls -lt /tmp/jrx-readiness-reports 2>/dev/null | head -5
EOF

TMP_REMOTE=$(mktemp)
printf '%s' "$REMOTE" > "$TMP_REMOTE"
bash "$ROOT/scripts/jrx-ec2-ssm-run.sh" "$TMP_REMOTE" "product-readiness-10k-bundle"
rm -f "$TMP_REMOTE"
