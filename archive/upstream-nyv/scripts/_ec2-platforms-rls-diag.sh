#!/usr/bin/env bash
set -euo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
DB_ADMIN="$(grep -E '^DATABASE_URL_ADMIN=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n' )"
DB_RUNTIME="$(grep -E '^DATABASE_URL=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n' )"

docker exec -e "A=${DB_ADMIN}" -e "R=${DB_RUNTIME}" -w /app nyv-gateway \
  node --input-type=module -e "
import pg from 'pg';
async function probe(url,label){
  const pool=new pg.Pool({connectionString:url,ssl:{rejectUnauthorized:false}});
  try{
    const u=await pool.query('SELECT current_user, current_database()');
    console.log(label,'user/db:',u.rows[0].current_user, u.rows[0].current_database);
    const rls=await pool.query(\"SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid='nv_sdk_applications'::regclass\");
    console.log(label,'rls:',rls.rows[0]);
    const c=await pool.query('SELECT COUNT(*)::int c FROM nv_sdk_applications');
    console.log(label,'count:',c.rows[0].c);
    const e=await pool.query(\"SELECT COUNT(*)::int c FROM nv_sdk_applications WHERE platform_type IS NOT NULL AND platform_type<>'custom'\");
    console.log(label,'ecosystem:',e.rows[0].c);
    const pol=await pool.query(\"SELECT polname, polcmd FROM pg_policy WHERE polrelid='nv_sdk_applications'::regclass\");
    console.log(label,'policies:', pol.rows.map(p=>p.polname+':'+p.polcmd).join(', ')||'none');
  }catch(e){console.log(label,'ERR:',e.message);} finally{await pool.end();}
}
await probe(process.env.A,'admin ');
await probe(process.env.R,'runtm ');
"
