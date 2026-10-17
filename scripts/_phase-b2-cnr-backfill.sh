#!/usr/bin/env bash
# Phase B-2 CNR backfill — smaller batches, 8GB heap
set -uo pipefail
cd /opt/nyv/api
export NODE_OPTIONS=--max-old-space-size=8192
echo "=== PRE cnr_case_details ==="
node --input-type=module <<'NODE'
import pg from 'pg';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { RDSClient, DescribeDBInstancesCommand } from '@aws-sdk/client-rds';
const r = await new RDSClient({ region: 'ap-south-1' }).send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: 'jrx-caselaw-pg' }));
const i = r.DBInstances[0];
const s = await new SecretsManagerClient({ region: 'ap-south-1' }).send(new GetSecretValueCommand({ SecretId: i.MasterUserSecret.SecretArn }));
const c = JSON.parse(s.SecretString);
const cl = new pg.Client({ host: i.Endpoint.Address, port: i.Endpoint.Port, database: i.DBName, user: c.username, password: c.password, ssl: { rejectUnauthorized: false } });
await cl.connect();
const n = await cl.query('SELECT count(*)::text c FROM cnr_case_details');
console.log('cnr_case_details', n.rows[0].c);
await cl.end();
NODE

echo "=== CNR INGEST (5 partitions per batch) ==="
nohup env NODE_OPTIONS=--max-old-space-size=8192 node ingest-cnr-case-details.mjs 5 >> /opt/nyv/logs/cnr-case-details-b2.log 2>&1 &
echo "CNR_PID=$! log=/opt/nyv/logs/cnr-case-details-b2.log"
sleep 2
tail -5 /opt/nyv/logs/cnr-case-details-b2.log 2>/dev/null || true
