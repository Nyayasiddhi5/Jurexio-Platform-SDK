#!/usr/bin/env bash
# Phase B worker backfills — CNR case details, SC FTS probe, graph edges count
set -uo pipefail
set -a; source /opt/nyv/api/.env; set +a
API=/opt/nyv/api
LOG=/opt/nyv/logs

echo "=== PRE-COUNTS ==="
cd "$API"
node --input-type=module -e "
import pg from 'pg';
const c=new pg.Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
await c.connect();
const q=async(s)=>{try{const r=await c.query(s);return r.rows[0].c}catch(e){return 'ERR:'+e.message}};
console.log('cnr_case_details', await q('SELECT count(*)::text c FROM cnr_case_details'));
console.log('citation_edges', await q('SELECT count(*)::text c FROM citation_edges'));
console.log('sc_body_fts', await q(\"SELECT count(*)::text c FROM judgments WHERE court_type='sc' AND body_fts IS NOT NULL\"));
console.log('sc_total', await q(\"SELECT count(*)::text c FROM judgments WHERE court_type='sc'\"));
await c.end();
"

echo "=== B3 CNR CASE DETAILS BACKFILL (50 partitions) ==="
if [ -f "$API/ingest-cnr-case-details.mjs" ]; then
  node "$API/ingest-cnr-case-details.mjs" 50 2>&1 | tail -20
elif [ -f "$API/nys-cnr-index-sync.mjs" ]; then
  JRX_ECOSYSTEM_CNR_DETAILS_LIMIT=50 node "$API/nys-cnr-index-sync.mjs" 2>&1 | tail -20
else
  echo "MISSING ingest scripts"
fi

echo "=== B5 SC FTS CHECKPOINT ==="
if [ -f "$API/.sc-body-fts-checkpoint.json" ]; then
  python3 -c "import json;d=json.load(open('$API/.sc-body-fts-checkpoint.json'));print('  checkpoint',d)"
else
  echo "  no checkpoint yet"
fi

echo "=== POST-COUNTS ==="
node --input-type=module -e "
import pg from 'pg';
const c=new pg.Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
await c.connect();
const q=async(s)=>{try{const r=await c.query(s);return r.rows[0].c}catch(e){return 'ERR:'+e.message}};
console.log('cnr_case_details', await q('SELECT count(*)::text c FROM cnr_case_details'));
console.log('sc_body_fts', await q(\"SELECT count(*)::text c FROM judgments WHERE court_type='sc' AND body_fts IS NOT NULL\"));
console.log('sc_total', await q(\"SELECT count(*)::text c FROM judgments WHERE court_type='sc'\"));
await c.end();
"

echo "=== PHASE B WORKER BACKFILL COMPLETE ==="
