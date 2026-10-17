#!/bin/bash
# nv-india-longtail-loop — keep draining statute_ingest_progress pending acts
# Deploy to /opt/nyv/api/nv-india-longtail-loop.sh on the caselaw worker.
while true; do
  if pgrep -f 'ingest-india-code.mjs' >/dev/null 2>&1; then
    sleep 120
    continue
  fi
  cd /opt/nyv/api
  PENDING=$(node --env-file=/opt/nyv/api/.env -e 'const {Pool}=require("pg"); const p=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}}); p.query("SELECT count(*)::int n FROM statute_ingest_progress WHERE status='\''pending'\''").then(r=>{process.stdout.write(String(r.rows[0].n)); return p.end();}).catch(()=>process.stdout.write("0"));')
  if [[ "${PENDING}" -le 0 ]]; then
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] india long-tail complete pending=0" >> /opt/nyv/india-longtail-loop.log
    sleep 600
    continue
  fi
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] starting india batch pending=$PENDING" >> /opt/nyv/india-longtail-loop.log
  NODE_ENV=production nice -n 5 node --env-file=/opt/nyv/api/.env /opt/nyv/api/ingest-india-code.mjs --limit 400 >> /opt/nyv/statute-ingest-worker.log 2>&1 || true
  sleep 30
done
