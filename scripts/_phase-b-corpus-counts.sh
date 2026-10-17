#!/usr/bin/env bash
# Live corpus counts on caselaw worker RDS
set -uo pipefail
cd /opt/nyv/api
node --input-type=module <<'NODE'
import pg from 'pg';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { RDSClient, DescribeDBInstancesCommand } from '@aws-sdk/client-rds';

const r = await new RDSClient({ region: 'ap-south-1' }).send(
  new DescribeDBInstancesCommand({ DBInstanceIdentifier: 'jrx-caselaw-pg' }),
);
const i = r.DBInstances[0];
const s = await new SecretsManagerClient({ region: 'ap-south-1' }).send(
  new GetSecretValueCommand({ SecretId: i.MasterUserSecret.SecretArn }),
);
const c = JSON.parse(s.SecretString);
const cl = new pg.Client({
  host: i.Endpoint.Address,
  port: i.Endpoint.Port,
  database: i.DBName,
  user: c.username,
  password: c.password,
  ssl: { rejectUnauthorized: false },
});
await cl.connect();

const q = await cl.query(`
  SELECT court_type,
    count(*)::bigint AS total,
    count(*) FILTER (WHERE body_search_tsv IS NOT NULL)::bigint AS body_fts,
    count(*) FILTER (WHERE embedding IS NOT NULL)::bigint AS embedded
  FROM judgments
  WHERE court_type IN ('sc','hc','dc')
  GROUP BY court_type
  ORDER BY court_type
`);
console.log('CORPUS_COUNTS', JSON.stringify(q.rows));

const cnr = await cl.query(`SELECT count(*)::bigint AS cnr_rows FROM cnr_case_details`);
console.log('CNR_ROWS', cnr.rows[0].cnr_rows);

const scNull = await cl.query(`
  SELECT
    count(*) FILTER (WHERE court_type='sc' AND body_search_tsv IS NULL)::bigint AS null_fts,
    count(*) FILTER (WHERE court_type='sc' AND body_search_tsv IS NULL AND pdf_link LIKE 's3://%')::bigint AS null_s3
  FROM judgments
`);
console.log('SC_FTS_GAP', JSON.stringify(scNull.rows[0]));

await cl.end();
NODE

echo "=== UNITS ==="
systemctl is-active jrx-caselaw-embed-loop@0 jrx-caselaw-embed-loop@1 jrx-caselaw-embed-loop@2 jrx-caselaw-embed-dc jrx-embed-statutes-loop 2>/dev/null || true
pgrep -af 'backfill-sc-body-fts|backfill-hc-dc-body-fts|embed-corpus' || echo "no backfill pids"
