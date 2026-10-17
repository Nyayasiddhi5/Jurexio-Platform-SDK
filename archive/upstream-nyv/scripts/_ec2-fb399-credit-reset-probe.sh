#!/usr/bin/env bash
# NV-FB399-001 — credit lens + reset for demo ssadmin org (org_id=1).
set -uo pipefail
EMAIL="${FB399_EMAIL:-superadmin@demo.nyayasiddhi.online}"
NSP_ORG="${FB399_NSP_ORG_ID:-10000000}"
G=$(docker ps --format '{{.Names}}' | grep -E 'gateway' | head -1)
echo "GATEWAY=$G RESET=${FB399_RESET:-0}"

docker exec "$G" node -e "
const email=process.argv[1];
const nspOrg=process.argv[2];
const doReset=process.argv[3]==='1';
const run=async(orgId,label)=>{
  const pg=await import('pg');
  const c=new pg.default.Client({connectionString:process.env.DATABASE_URL_ADMIN||process.env.DATABASE_URL});
  await c.connect();
  const daily=await c.query(\`SELECT COALESCE(SUM(tokens_used),0)::bigint t,COUNT(*)::int c FROM nv_schema.ai_credit_usage WHERE org_id=\$1 AND created_at>=DATE_TRUNC('day',NOW() AT TIME ZONE 'UTC')\`,[String(orgId)]);
  const ov=await c.query('SELECT daily_token_budget,hourly_request_limit FROM nv_schema.ai_credit_overrides WHERE org_id=\$1',[String(orgId)]);
  console.log(label+' org='+orgId+' tokens_today='+daily.rows[0].t+' requests='+daily.rows[0].c+' override='+(ov.rows[0]?ov.rows[0].daily_token_budget:'none'));
  if(doReset){
    const del=await c.query(\`DELETE FROM nv_schema.ai_credit_usage WHERE org_id=\$1 AND created_at>=DATE_TRUNC('day',NOW() AT TIME ZONE 'UTC') RETURNING id\`,[String(orgId)]);
    const budget=10000000,hourly=10000;
    await c.query(\`INSERT INTO nv_schema.ai_credit_overrides(org_id,daily_token_budget,hourly_request_limit,updated_at) VALUES(\$1,\$2,\$3,NOW()) ON CONFLICT(org_id) DO UPDATE SET daily_token_budget=\$2,hourly_request_limit=\$3,updated_at=NOW()\`,[String(orgId),budget,hourly]);
    console.log(label+' RESET deleted='+del.rows.length+' new_daily='+budget+' hourly='+hourly);
  }
  await c.end();
};
const main=async()=>{
  const pg=await import('pg');
  const c=new pg.default.Client({connectionString:process.env.DATABASE_URL_ADMIN||process.env.DATABASE_URL});
  await c.connect();
  const u=await c.query('SELECT id,email,org_id,role,tier FROM nv_users WHERE email=\$1',[email]);
  const r=u.rows[0];
  if(!r){console.log('USER missing '+email);process.exit(3);}
  console.log('USER id='+r.id+' email='+r.email+' org='+r.org_id+' role='+r.role+' tier='+r.tier);
  const org=await c.query('SELECT slug,name,tier FROM nv_organizations WHERE id=\$1',[r.org_id]);
  if(org.rows[0]) console.log('ORG slug='+org.rows[0].slug+' tier='+org.rows[0].tier);
  await c.end();
  await run(r.org_id,'SSADMIN');
  await run(nspOrg,'NSP');
};
main().catch(e=>{console.error('ERR',e.message);process.exit(4);});
" "$EMAIL" "$NSP_ORG" "${FB399_RESET:-0}" 2>&1
