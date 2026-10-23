#!/usr/bin/env bash
# SC FTS remaining rows analysis + retry unindexed
set -uo pipefail
cd /opt/nyv/api
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
const q = await cl.query(`
  SELECT
    count(*) FILTER (WHERE court_type='sc')::text sc_total,
    count(*) FILTER (WHERE court_type='sc' AND body_search_tsv IS NOT NULL)::text indexed,
    count(*) FILTER (WHERE court_type='sc' AND body_search_tsv IS NULL)::text null_fts,
    count(*) FILTER (WHERE court_type='sc' AND body_search_tsv IS NULL AND pdf_link LIKE 's3://%')::text null_s3,
    count(*) FILTER (WHERE court_type='sc' AND body_search_tsv IS NULL AND (pdf_link IS NULL OR pdf_link NOT LIKE 's3://%'))::text null_no_s3
  FROM judgments
`);
console.log('sc_fts_breakdown', q.rows[0]);
await cl.end();
NODE
# Reset checkpoint for forward retry on remaining s3 rows
if [ -f .sc-body-fts-checkpoint.json ]; then
  mv .sc-body-fts-checkpoint.json .sc-body-fts-checkpoint.json.bak-b2
  echo "checkpoint backed up"
fi
pkill -f backfill-sc-body-fts.mjs 2>/dev/null || true
sleep 1
nohup env SC_BODY_FTS_BATCH=25 SC_BODY_FTS_CONCURRENCY=1 node backfill-sc-body-fts.mjs >> /opt/nyv/logs/sc-body-fts-b2-retry.log 2>&1 &
echo "SC_FTS_RETRY_PID=$!"
sleep 8
tail -10 /opt/nyv/logs/sc-body-fts-b2-retry.log 2>/dev/null || true
