#!/usr/bin/env bash
set -uo pipefail
echo "=== NYS DETAIL $(date -u +%H:%M:%S) ==="
curl -sS -m 10 -w "\nhealthz_http=%{http_code}\n" http://127.0.0.1:8080/healthz | head -3

set -a && source /opt/nyv/api/.env && set +a
KEY="${NYS_KNOWLEDGE_API_KEY:-${NYS_SDK_API_KEYS:-}}"; KEY="${KEY%%,*}"

echo "--- SC body FTS progress ---"
node /opt/nyv/api/apply-sc-body-fts-ddl.mjs 2>/dev/null | tail -1
node -e "
const pg=require('pg');
(async()=>{
  const p=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
  const total=await p.query(\"SELECT COUNT(*)::int n FROM judgments WHERE court_type='sc'\");
  const indexed=await p.query(\"SELECT COUNT(*)::int n FROM judgments WHERE court_type='sc' AND body_search_tsv IS NOT NULL\");
  const edges=await p.query(\"SELECT to_regclass('public.citation_edges') IS NOT NULL AS exists\");
  let edgeCount='n/a';
  if(edges.rows[0].exists){
    const ec=await p.query('SELECT COUNT(*)::int n FROM citation_edges');
    edgeCount=ec.rows[0].n;
  }
  const pct=(100*indexed.rows[0].n/total.rows[0].n).toFixed(2);
  console.log('sc_total', total.rows[0].n, 'sc_body_indexed', indexed.rows[0].n, 'pct', pct+'%', 'citation_edges', edgeCount);
  await p.end();
})();" 2>&1

echo "--- caselaw search (fts mode) ---"
curl -sS -m 30 -w "\nhttp=%{http_code}\n" -H "x-api-key: $KEY" \
  "http://127.0.0.1:8080/api/caselaw/search?q=bail&limit=2&jurisdiction=IN&courtType=sc&mode=fts" | tail -5

echo "--- sc-body-fts final stats ---"
grep -E 'processed|indexed|done|complete|errors' /opt/nyv/logs/sc-body-fts.log 2>/dev/null | tail -3
echo "--- extract final stats ---"
grep -E 'processed|extracted|done|complete|errors' /opt/nyv/logs/treatment-graph-extract.log 2>/dev/null | tail -3
echo "--- edges final stats ---"
grep -E 'edgesWritten|done|complete|errors' /opt/nyv/logs/treatment-graph-edges.log 2>/dev/null | tail -3

echo "--- Athena env ---"
grep '^ATHENA_TABLE_HC_CASE_DETAILS=' /opt/nyv/api/.env | tail -1

echo "--- CNR Athena cold path test (synthetic miss RDS) ---"
# probe that sourcesTried includes athena when needed
curl -sf -m 90 -X POST -H 'Content-Type: application/json' -H "X-API-Key: ${KEY}" \
  -d '{"cnr":"RJHC010324382023","options":{"profile":"caseCreate"}}' \
  http://127.0.0.1:8080/api/cnr/resolve | python3 -c "
import sys,json
d=json.load(sys.stdin)
data=d.get('data') or {}
print('status', data.get('status'), 'source', data.get('source'))
print('sourcesTried', data.get('sourcesTried'))
cc=data.get('caseCreate') or {}
print('fieldManifest keys', list((cc.get('fieldManifest') or {}).keys())[:8])
"
