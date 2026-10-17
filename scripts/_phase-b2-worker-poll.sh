#!/usr/bin/env bash
# Worker job status poll — CNR + SC FTS
set -uo pipefail
echo "=== EMBED (must stay paused) ==="
for u in nyv-caselaw-embed-loop@0 nyv-caselaw-embed-dc; do
  echo "  $u $(systemctl is-active $u 2>/dev/null || echo inactive)"
done
echo "=== JOB PIDS ==="
pgrep -af 'ingest-cnr-case-details|backfill-sc-body-fts|graph-ingest' || echo "no matching pids"
echo "=== CNR LOG tail ==="
tail -8 /opt/nyv/logs/cnr-case-details-b2.log 2>/dev/null || echo "no cnr log"
echo "=== SC FTS LOG tail ==="
tail -8 /opt/nyv/logs/sc-body-fts-b2.log 2>/dev/null || echo "no sc log"
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
const sc = await cl.query("SELECT count(*)::text total, count(*) FILTER (WHERE body_search_tsv IS NOT NULL)::text indexed FROM judgments WHERE court_type='sc'");
console.log('cnr_case_details', n.rows[0].c);
console.log('sc_body_search_tsv', sc.rows[0].indexed + '/' + sc.rows[0].total);
await cl.end();
NODE
