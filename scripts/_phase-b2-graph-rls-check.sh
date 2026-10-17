#!/usr/bin/env bash
# Check RLS policies + admin DB URL availability on nysdev (no secret values)
set -uo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
has_admin=$(grep -c '^DATABASE_URL_ADMIN=' "$CANON" 2>/dev/null || echo 0)
has_db=$(grep -c '^DATABASE_URL=' "$CANON" 2>/dev/null || echo 0)
echo "has_DATABASE_URL=$has_db has_DATABASE_URL_ADMIN=$has_admin"
DB="$(grep -E '^DATABASE_URL=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')"
docker exec -e NYV_DATABASE_URL="$DB" -w /app nyv-gateway node --input-type=module -e "
import pg from 'pg';
const c=new pg.Client({connectionString:process.env.NYV_DATABASE_URL,ssl:{rejectUnauthorized:false}});
await c.connect();
const role=await c.query('SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user');
console.log('current_role', role.rows[0]);
const pol=await c.query(\`
  SELECT pol.polname, pol.polcmd, pg_get_expr(pol.polqual, pol.polrelid) qual, pg_get_expr(pol.polwithcheck, pol.polrelid) wcheck
  FROM pg_policy pol JOIN pg_class cls ON cls.oid=pol.polrelid
  JOIN pg_namespace n ON n.oid=cls.relnamespace
  WHERE n.nspname='nv_schema' AND cls.relname LIKE 'nv_legal_graph%'
\`);
console.log('policies', pol.rows);
await c.end();
"
