#!/usr/bin/env bash
set -uo pipefail
cd /opt/nyv/api
node apply-sc-body-fts-ddl.mjs 2>/dev/null | tail -1
node apply-sc-body-fts-ddl.mjs 2>/dev/null | python3 -c "
import sys,json,re
for line in sys.stdin:
  if 'SC_BODY_FTS_DDL_OK' in line:
    m=re.search(r'\{.*\}', line)
    if m:
      d=json.loads(m.group())
      indexed=int(d.get('sc_body_indexed',0))
      total=43505
      print('sc_body_indexed', indexed, 'sc_total', total, 'pct', round(100*indexed/total,2))
"
echo "--- sc-body-fts completion ---"
grep -E 'SC_BODY_FTS_COMPLETE|SC_BODY_FTS_FAIL' /opt/nyv/logs/sc-body-fts.log 2>/dev/null | tail -1 || tail -1 /opt/nyv/logs/sc-body-fts.log
echo "--- extract completion ---"
grep -E 'COMPLETE|done' /opt/nyv/logs/treatment-graph-extract.log 2>/dev/null | tail -1
echo "--- edges completion ---"
grep -E 'COMPLETE|done' /opt/nyv/logs/treatment-graph-edges.log 2>/dev/null | tail -1
echo "--- citation_edges count via apply script pool ---"
node - <<'NODE'
const fs=require('fs');
const path='/opt/nyv/api/.env';
const env=Object.fromEntries(fs.readFileSync(path,'utf8').split('\n').filter(l=>l&&!l.startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1).replace(/^["']|["']$/g,'')]}));
process.env.DATABASE_URL=env.DATABASE_URL||env.NYS_DATABASE_URL;
const pg=require('pg');
(async()=>{
  const p=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
  try{
    const e=await p.query('SELECT COUNT(*)::int n FROM citation_edges');
    console.log('citation_edges_rows', e.rows[0].n);
  }catch(err){
    console.log('citation_edges', err.message.split('\n')[0]);
  }
  await p.end();
})();
NODE
