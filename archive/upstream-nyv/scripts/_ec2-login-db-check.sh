#!/usr/bin/env bash
set -euo pipefail
docker exec -w /app nyv-gateway npx tsx scripts/_ec2-bcrypt-check.ts 2>&1 || \
docker exec -w /app nyv-gateway sh -c 'NV_DEMO_PASSWORD=$(grep ^NV_DEMO_PASSWORD= /opt/Nyayavigya/secrets/.env.production 2>/dev/null | cut -d= -f2- | tr -d "\"'"'"'" ) || NV_DEMO_PASSWORD=$(grep ^NV_DEMO_PASSWORD= .env | cut -d= -f2- | tr -d "\"'"'"'" ); DATABASE_URL=$(grep ^DATABASE_URL_ADMIN= .env | cut -d= -f2- | tr -d "\"'"'"'" ); export NV_DEMO_PASSWORD DATABASE_URL; npx tsx -e "
import pg from \"pg\";
import bcrypt from \"bcrypt\";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const email = \"admin@nyayavigya.in\";
const r = await pool.query(\"SELECT id, email, role, is_active, length(password_hash) as hash_len FROM nv_users WHERE email=\$1\", [email]);
console.log(\"admin via ADMIN:\", r.rows[0] || \"MISSING\");
const pw = process.env.NV_DEMO_PASSWORD || \"\";
if (r.rows[0]?.password_hash && pw) console.log(\"bcrypt:\", await bcrypt.compare(pw, r.rows[0].password_hash));
const r2 = await pool.query(\"SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user\");
console.log(\"db role:\", r2.rows[0]);
await pool.end();
"'

