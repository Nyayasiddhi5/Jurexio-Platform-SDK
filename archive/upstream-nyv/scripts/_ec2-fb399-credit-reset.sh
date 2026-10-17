#!/usr/bin/env bash
# NV-FB399-001 — reset daily AI credits + raise override for ssadmin org + NSP org.
set -uo pipefail
G=$(docker ps --format '{{.Names}}' | grep -E 'gateway' | head -1)
docker exec "$G" node -e "
const run=async()=>{
  const pg=await import('pg');
  const c=new pg.default.Client({connectionString:process.env.DATABASE_URL_ADMIN||process.env.DATABASE_URL});
  await c.connect();
  const u=await c.query('SELECT id,org_id FROM nv_users WHERE email=\$1',['superadmin@demo.nyayasiddhi.online']);
  const ssOrg=String(u.rows[0]?.org_id ?? '1');
  for (const orgId of [ssOrg,'10000000']) {
    const del=await c.query(\`DELETE FROM nv_schema.ai_credit_usage WHERE org_id=\$1 AND created_at>=DATE_TRUNC('day',NOW() AT TIME ZONE 'UTC') RETURNING id\`,[orgId]);
    const budget=10000000,hourly=10000;
    await c.query(\`INSERT INTO nv_schema.ai_credit_overrides(org_id,daily_token_budget,hourly_request_limit,updated_at) VALUES(\$1,\$2,\$3,NOW()) ON CONFLICT(org_id) DO UPDATE SET daily_token_budget=\$2,hourly_request_limit=\$3,updated_at=NOW()\`,[orgId,budget,hourly]);
    console.log('RESET org='+orgId+' deleted='+del.rows.length+' daily='+budget+' hourly='+hourly);
  }
  await c.end();
};
run().catch(e=>{console.error('ERR',e.message);process.exit(1);});
"
