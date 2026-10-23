#!/bin/bash
# nv-embed-null-loop — re-embed NULL statute rows while ingest runs
# embed-statutes.mjs args: [maxRows=50000] [batchSize=100]
# Do NOT pass --null-only (Number("--null-only") === NaN → done:0).
while true; do
  if pgrep -f 'embed-statutes.mjs' >/dev/null 2>&1; then
    sleep 60
    continue
  fi
  cd /opt/nyv/api
  NODE_ENV=production nice -n 10 node --env-file=/opt/nyv/api/.env /opt/nyv/api/embed-statutes.mjs 20000 100 >> /opt/nyv/embed-statutes-null.log 2>&1 || true
  sleep 120
done
