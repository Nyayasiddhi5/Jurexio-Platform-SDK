#!/usr/bin/env bash
# Worker counts via Secrets Manager caselaw RDS
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
const sc = await cl.query("SELECT count(*)::text total, count(*) FILTER (WHERE body_search_tsv IS NOT NULL)::text indexed FROM judgments WHERE court_type='sc'");
console.log('cnr_case_details', n.rows[0].c);
console.log('sc_body_search_tsv', sc.rows[0].indexed + '/' + sc.rows[0].total);
await cl.end();
NODE
