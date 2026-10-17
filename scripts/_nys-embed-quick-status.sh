#!/usr/bin/env bash
set -uo pipefail
echo "=== $(date -Is) embed status ==="
pgrep -af embed-corpus.mjs | head -8
tail -3 /opt/nyv/embed-stall.log 2>/dev/null
tail -8 /opt/nyv/embed.log 2>/dev/null || tail -8 /opt/nyv/embed-loop.log 2>/dev/null
cd /opt/nyv/api && node --env-file=/opt/nyv/api/.env - <<'JS'
import { RDSClient, DescribeDBInstancesCommand } from "@aws-sdk/client-rds";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import pg from "pg";
const R = "ap-south-1";
const d = await new RDSClient({ region: R }).send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: "nyv-caselaw-pg" }));
const i = d.DBInstances?.[0];
const s = await new SecretsManagerClient({ region: R }).send(new GetSecretValueCommand({ SecretId: i.MasterUserSecret.SecretArn }));
const cr = JSON.parse(s.SecretString);
const c = new pg.Client({ host: i.Endpoint.Address, port: i.Endpoint.Port ?? 5432, database: i.DBName ?? "nyv_caselaw", user: cr.username, password: cr.password, ssl: { rejectUnauthorized: false }, statement_timeout: 15000 });
await c.connect();
const r = await c.query(`SELECT scope, last_id, total_embedded, updated_at FROM embed_progress WHERE scope LIKE 'hc:%' OR scope='dc' ORDER BY scope`);
for (const row of r.rows) console.log(`${row.scope}\tlast_id=${row.last_id}\tembedded=${row.total_embedded}\tupdated=${row.updated_at}`);
await c.end();
JS
