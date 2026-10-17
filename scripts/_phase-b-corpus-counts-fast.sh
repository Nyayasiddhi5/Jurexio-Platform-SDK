#!/usr/bin/env bash
# Fast corpus counts — SC exact; HC/DC embed from daily snapshot + SC FTS live
set -uo pipefail
cd /opt/nyv/api

echo "=== DAILY EMBED SNAPSHOT ==="
if [ -f /opt/nyv/embed-coverage-latest.json ]; then
  cat /opt/nyv/embed-coverage-latest.json
else
  echo "NO_DAILY_SNAPSHOT"
fi

echo "=== SC FTS (exact, small table) ==="
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
const sc = await cl.query(`
  SELECT count(*)::int total,
    count(*) FILTER (WHERE body_search_tsv IS NOT NULL)::int indexed,
    count(*) FILTER (WHERE body_search_tsv IS NULL AND pdf_link LIKE 's3://%')::int null_s3,
    count(*) FILTER (WHERE embedding IS NOT NULL)::int embedded
  FROM judgments WHERE court_type = 'sc'
`);
console.log('SC_COUNTS', JSON.stringify(sc.rows[0]));
const cnr = await cl.query(`SELECT count(*)::bigint cnr FROM cnr_case_details`);
console.log('CNR_ROWS', cnr.rows[0].cnr);
const hcBody = await cl.query(`SELECT count(*)::bigint n FROM judgments WHERE court_type='hc' AND body_search_tsv IS NOT NULL`);
const dcBody = await cl.query(`SELECT count(*)::bigint n FROM judgments WHERE court_type='dc' AND body_search_tsv IS NOT NULL`);
console.log('HC_BODY_FTS', hcBody.rows[0].n);
console.log('DC_BODY_FTS', dcBody.rows[0].n);
await cl.end();
NODE

echo "=== UNITS ==="
systemctl is-active jrx-caselaw-embed-loop@0 jrx-caselaw-embed-loop@1 jrx-caselaw-embed-loop@2 jrx-caselaw-embed-dc jrx-embed-statutes-loop 2>/dev/null || true
pgrep -af 'backfill-sc-body-fts|backfill-hc-dc-body-fts|embed-corpus' || echo "no backfill pids"
