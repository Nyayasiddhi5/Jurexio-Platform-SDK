#!/usr/bin/env bash
# Seed UAT Legal Chat users + sync superadmin demo password on EC2 (no password echo).
set -euo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
NV_DEMO_PW="$(grep -E '^NV_DEMO_PASSWORD=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')"
export NV_DEMO_PASSWORD="$NV_DEMO_PW"
export NV_UAT_ADMIN_PASSWORD="$NV_DEMO_PW"
export NV_UAT_SME_PASSWORD="$NV_DEMO_PW"
export NV_UAT_SME_B_PASSWORD="$NV_DEMO_PW"
docker exec -e NV_DEMO_PASSWORD="$NV_DEMO_PW" \
  -e NV_UAT_ADMIN_PASSWORD="$NV_DEMO_PW" \
  -e NV_UAT_SME_PASSWORD="$NV_DEMO_PW" \
  -e NV_UAT_SME_B_PASSWORD="$NV_DEMO_PW" \
  -w /app nyv-gateway npx tsx scripts/jrx-seed-uat-platform-users.ts 2>&1 | tail -12
echo "=== sync admin@nyayavigya.in demo password ==="
docker exec -e NV_DEMO_PW="$NV_DEMO_PW" -w /app nyv-gateway node -e "
const bcrypt = require('bcrypt');
(async () => {
  const pw = process.env.NV_DEMO_PW;
  if (!pw || pw.length < 8) throw new Error('NV_DEMO_PASSWORD missing');
  const hash = await bcrypt.hash(pw, 10);
  const { Pool } = require('pg');
  const url = process.env.DATABASE_URL_ADMIN || process.env.DATABASE_URL;
  const pool = new Pool({ connectionString: url, ssl: url.includes('localhost') ? false : { rejectUnauthorized: false } });
  const r = await pool.query(
    \"UPDATE public.nv_users SET password_hash=\$1, is_active=true WHERE email='admin@nyayavigya.in' RETURNING email\",
    [hash]
  );
  console.log(r.rowCount ? 'admin@nyayavigya.in password synced' : 'admin@nyayavigya.in not found');
  for (const email of ['legalchat-sme-a-uat@nyayavigya.in','legalchat-sme-b-uat@nyayavigya.in']) {
    const u = await pool.query('SELECT id FROM public.nv_users WHERE email=\$1', [email]);
    const uid = u.rows[0]?.id;
    if (uid) {
      await pool.query(
        \"INSERT INTO legal_chat_sme_allocations(user_id, email, is_active) SELECT \$1::text, \$2, true WHERE NOT EXISTS (SELECT 1 FROM legal_chat_sme_allocations WHERE email=\$2)\",
        [String(uid), email]
      );
    }
  }
  console.log('SME allocations synced');
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
"
