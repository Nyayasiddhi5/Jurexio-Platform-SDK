#!/usr/bin/env bash
# Run product-readiness-10k inside EC2 gateway container (uses production secrets — no password echo).
set -euo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
read_env() { grep -E "^${1}=" "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n'; }
NV_DEMO_PW="$(read_env NV_DEMO_PASSWORD)"
BUCKET="${NYV_DEPLOY_BUCKET:-nyayavigya-sdk-devapp}"
REGION="${NYV_AWS_REGION:-ap-south-1}"
export GATEWAY="${GATEWAY:-https://api.nyayasiddhi.online}"
export CONSOLE_URL="${CONSOLE_URL:-https://console.nyayasiddhi.online}"
export UAT_ADMIN_EMAIL="${UAT_ADMIN_EMAIL:-admin@nyayavigya.in}"
export UAT_ADMIN_PASSWORD="${UAT_ADMIN_PASSWORD:-$NV_DEMO_PW}"
export UAT_SME_EMAIL="${UAT_SME_EMAIL:-legalchat-sme-a-uat@nyayavigya.in}"
export UAT_SME_PASSWORD="${UAT_SME_PASSWORD:-$NV_DEMO_PW}"
export NYV_SDK_KEY_NSP="$(read_env NYV_SDK_KEY_NSP)"
export NYV_SDK_KEY_NSI="$(read_env NYV_SDK_KEY_NSI)"
export NYV_SDK_KEY_NYM="$(read_env NYV_SDK_KEY_NYM)"
export NYV_SDK_KEY_NSA="$(read_env NYV_SDK_KEY_NSA)"
export NYV_SDK_KEY_NSM="$(read_env NYV_SDK_KEY_NSM)"
echo "=== seed UAT users (demo password) ==="
docker exec -e NV_DEMO_PASSWORD="$NV_DEMO_PW" \
  -e NV_UAT_ADMIN_PASSWORD="$NV_DEMO_PW" \
  -e NV_UAT_SME_PASSWORD="$NV_DEMO_PW" \
  -w /app nyv-gateway npx tsx scripts/jrx-seed-uat-platform-users.ts 2>&1 | tail -8
echo "=== sync admin@nyayavigya.in demo password ==="
docker exec -e NV_DEMO_PW="$NV_DEMO_PW" -w /app nyv-gateway node -e "
const bcrypt = require('bcrypt');
(async () => {
  const pw = process.env.NV_DEMO_PW;
  const hash = await bcrypt.hash(pw, 10);
  const { Pool } = require('pg');
  const url = process.env.DATABASE_URL_ADMIN || process.env.DATABASE_URL;
  const pool = new Pool({ connectionString: url, ssl: url.includes('localhost') ? false : { rejectUnauthorized: false } });
  await pool.query(\"UPDATE public.nv_users SET password_hash=\$1, is_active=true WHERE email='admin@nyayavigya.in'\", [hash]);
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
" && echo "admin@nyayavigya.in password synced"
echo "=== S3 fixture presign (host aws) ==="
TMP="/tmp/jrx-readiness-nda.txt"
printf '%s\n' 'MUTUAL NON-DISCLOSURE AGREEMENT (UAT fixture)' 'Parties: Nyayavigya Platform UAT' 'Term: 12 months from execution.' > "$TMP"
S3_KEY="product-readiness/$(date -u +%F)/sample-nda-$(date +%s).txt"
aws s3 cp "$TMP" "s3://${BUCKET}/${S3_KEY}" --region "$REGION" --content-type text/plain
export PRODUCT_READINESS_PRESIGNED_URL="$(aws s3 presign "s3://${BUCKET}/${S3_KEY}" --expires-in 3600 --region "$REGION")"
export PRODUCT_READINESS_S3_KEY="$S3_KEY"
echo "presign ready (host)"
echo "=== product-readiness-10k ==="
docker exec nyv-gateway mkdir -p /app/tests/fixtures/product-readiness
docker cp "$TMP" nyv-gateway:/app/tests/fixtures/product-readiness/sample-nda.txt
# Sync latest readiness scripts into running container (no full image rebuild).
docker cp scripts/jrx-product-readiness-10k.ts nyv-gateway:/app/scripts/jrx-product-readiness-10k.ts 2>/dev/null || true
docker cp scripts/jrx-seed-uat-platform-users.ts nyv-gateway:/app/scripts/jrx-seed-uat-platform-users.ts 2>/dev/null || true
docker exec -e GATEWAY="$GATEWAY" \
  -e CONSOLE_URL="$CONSOLE_URL" \
  -e UAT_ADMIN_EMAIL="$UAT_ADMIN_EMAIL" \
  -e UAT_ADMIN_PASSWORD="$UAT_ADMIN_PASSWORD" \
  -e UAT_SME_EMAIL="$UAT_SME_EMAIL" \
  -e UAT_SME_PASSWORD="$UAT_SME_PASSWORD" \
  -e NYV_SDK_KEY_NSP="$NYV_SDK_KEY_NSP" \
  -e NYV_SDK_KEY_NSI="$NYV_SDK_KEY_NSI" \
  -e NYV_SDK_KEY_NYM="$NYV_SDK_KEY_NYM" \
  -e NYV_SDK_KEY_NSA="$NYV_SDK_KEY_NSA" \
  -e NYV_SDK_KEY_NSM="$NYV_SDK_KEY_NSM" \
  -e PRODUCT_READINESS_PRESIGNED_URL="$PRODUCT_READINESS_PRESIGNED_URL" \
  -e PRODUCT_READINESS_S3_KEY="$PRODUCT_READINESS_S3_KEY" \
  -e NYV_DEPLOY_BUCKET="$BUCKET" \
  -e NYV_AWS_REGION="$REGION" \
  -w /app nyv-gateway npx tsx scripts/jrx-product-readiness-10k.ts 2>&1 | tail -65
