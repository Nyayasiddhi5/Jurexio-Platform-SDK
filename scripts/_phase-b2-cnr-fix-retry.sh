#!/usr/bin/env bash
# Fix CNR ingest pino worker path + retry
set -uo pipefail
cd /opt/nyv/api
# Bundled ingest embeds dev-machine pino worker path — symlink from node_modules
WORKER_SRC="$(find node_modules -path '*/thread-stream/lib/worker.js' 2>/dev/null | head -1)"
echo "pino_worker_src=${WORKER_SRC:-MISSING}"
BROKEN='/Users/vamsit/Desktop/cursor-workspace/nyayavigya-platform-5.0.0-CURSOR-CLOUD/nyayavigya-platform-5.0.0/nyayavigya-platform-312/jrx-search/artifacts/api-server/dist/thread-stream-worker.mjs'
mkdir -p "$(dirname "$BROKEN")" 2>/dev/null || true
if [ -n "$WORKER_SRC" ]; then
  cp "$WORKER_SRC" "$BROKEN" 2>/dev/null || ln -sf "$WORKER_SRC" "$BROKEN" 2>/dev/null || true
fi
ls -la "$BROKEN" 2>/dev/null || echo "could not fix worker path"
echo "=== CNR pre-count ==="
node --input-type=module <<'NODE'
import pg from 'pg';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { RDSClient, DescribeDBInstancesCommand } from '@aws-sdk/client-rds';
const r = await new RDSClient({ region: 'ap-south-1' }).send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: 'nyv-caselaw-pg' }));
const i = r.DBInstances[0];
const s = await new SecretsManagerClient({ region: 'ap-south-1' }).send(new GetSecretValueCommand({ SecretId: i.MasterUserSecret.SecretArn }));
const c = JSON.parse(s.SecretString);
const cl = new pg.Client({ host: i.Endpoint.Address, port: i.Endpoint.Port, database: i.DBName, user: c.username, password: c.password, ssl: { rejectUnauthorized: false } });
await cl.connect();
console.log('cnr_case_details', (await cl.query('SELECT count(*)::text c FROM cnr_case_details')).rows[0].c);
await cl.end();
NODE
echo "=== CNR ingest 5 partitions (8GB heap) ==="
export NODE_OPTIONS=--max-old-space-size=8192
nohup node ingest-cnr-case-details.mjs 5 >> /opt/nyv/logs/cnr-case-details-b2.log 2>&1 &
echo "CNR_PID=$!"
sleep 5
tail -8 /opt/nyv/logs/cnr-case-details-b2.log
