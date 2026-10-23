#!/usr/bin/env bash
set -uo pipefail
cd /opt/nyv/api
set -a && source .env && set +a

echo "=== SC totals via apply script ==="
node apply-sc-body-fts-ddl.mjs 2>/dev/null | tail -1

echo "=== Worker job status ==="
pgrep -af 'backfill-sc-body-fts|nys-treatment-graph' || echo "no active worker pids"

echo "=== Job completion summary ==="
for f in sc-body-fts treatment-graph-extract treatment-graph-edges; do
  echo "-- $f --"
  tail -1 /opt/nyv/logs/${f}.log 2>/dev/null || echo empty
done

echo "=== citation_edges via node in api dir ==="
node -e "
const pg=require('pg');
(async()=>{
  const p=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
  try{
    const sc=await p.query(\"SELECT COUNT(*)::int n FROM judgments WHERE court_type='sc'\");
    const idx=await p.query(\"SELECT COUNT(*)::int n FROM judgments WHERE court_type='sc' AND body_search_tsv IS NOT NULL\");
    let edges='missing_table';
    try{
      const e=await p.query('SELECT COUNT(*)::int n FROM citation_edges');
      edges=e.rows[0].n;
    }catch(e){edges='err:'+e.message.split('\\n')[0]}
    console.log(JSON.stringify({sc_total:sc.rows[0].n, sc_body_indexed:idx.rows[0].n, pct:+(100*idx.rows[0].n/sc.rows[0].n).toFixed(2), citation_edges:edges}));
  }finally{await p.end();}
})();
"

echo "=== API health routes ==="
curl -sS -m 5 -w " /api/health http=%{http_code}\n" http://127.0.0.1:8080/api/health | head -1
curl -sS -m 5 -w " /healthz http=%{http_code}\n" http://127.0.0.1:8080/healthz | head -1

echo "=== Athena table row count (if configured) ==="
node -e "
const {AthenaClient,StartQueryExecutionCommand,GetQueryExecutionCommand,GetQueryResultsCommand}=require('@aws-sdk/client-athena');
(async()=>{
  const table=process.env.ATHENA_TABLE_HC_CASE_DETAILS||'judgments_meta_hc_case_details';
  const db=process.env.ATHENA_DATABASE||'nyv_docs';
  const client=new AthenaClient({region:process.env.AWS_REGION||'ap-south-1'});
  const q='SELECT COUNT(*) AS n FROM '+db+'.'+table;
  const start=await client.send(new StartQueryExecutionCommand({
    QueryString:q,
    QueryExecutionContext:{Database:db},
    ResultConfiguration:{OutputLocation:process.env.ATHENA_OUTPUT||'s3://jrx-athena-results/'}
  }));
  const id=start.QueryExecutionId;
  for(let i=0;i<30;i++){
    const g=await client.send(new GetQueryExecutionCommand({QueryExecutionId:id}));
    const st=g.QueryExecution.Status.State;
    if(st==='SUCCEEDED'||st==='FAILED'||st==='CANCELLED') break;
    await new Promise(r=>setTimeout(r,1000));
  }
  const res=await client.send(new GetQueryResultsCommand({QueryExecutionId:id}));
  const val=res.ResultSet.Rows[1].Data[0].VarCharValue;
  console.log('athena_table', table, 'rows', val);
})().catch(e=>console.log('athena_err', e.message.split('\\n')[0]));
" 2>&1
