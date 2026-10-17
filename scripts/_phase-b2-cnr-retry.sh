#!/usr/bin/env bash
# CNR ingest progress + remaining partitions
set -uo pipefail
cd /opt/nyv/api
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
const n = await cl.query('SELECT count(*)::text c FROM cnr_case_details');
const prog = await cl.query("SELECT count(*)::text done, coalesce(sum(row_count),0)::text rows FROM ingest_progress WHERE partition_key LIKE 'hc-case-details/%'");
console.log('cnr_case_details', n.rows[0].c);
console.log('ingest_progress_partitions', prog.rows[0]);
await cl.end();
NODE
echo "=== try CNR ingest 3 partitions foreground ==="
export NODE_OPTIONS=--max-old-space-size=8192
node ingest-cnr-case-details.mjs 3 2>&1 | tail -25
