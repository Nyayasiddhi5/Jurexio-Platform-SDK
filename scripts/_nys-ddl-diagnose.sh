#!/usr/bin/env bash
set -uo pipefail
set -a
source /opt/nyv/api/.env
set +a
node -e "
const pg=require('pg');
(async()=>{
  const url=process.env.DATABASE_URL;
  if(!url){console.log('NO_DATABASE_URL'); return;}
  const p=new pg.Pool({connectionString:url, ssl:{rejectUnauthorized:false}});
  try{
    const r=await p.query(\"SELECT column_name FROM information_schema.columns WHERE table_name='judgments' AND column_name='body_search_tsv'\");
    console.log('api_db_col', r.rowCount);
    const s=await p.query('SELECT current_database(), current_schema()');
    console.log('db', s.rows[0]);
  }catch(e){console.log('err', e.message);}
  await p.end();
})();
"
node /opt/nyv/api/apply-sc-body-fts-ddl.mjs 2>&1 | tail -1
