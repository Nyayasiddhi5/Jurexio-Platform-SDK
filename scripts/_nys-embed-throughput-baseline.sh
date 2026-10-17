#!/usr/bin/env bash
# Snapshot embed_progress + coverage for throughput measurement (no secrets).
set -uo pipefail
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
echo "=== BASELINE $TS ==="
curl -sS -m 10 -o /dev/null -w "coverage_localhost http=%{http_code}\n" http://127.0.0.1:8080/api/caselaw/embedding/coverage 2>/dev/null || true
cat /opt/nyv/embed-coverage-latest.json 2>/dev/null || echo "no coverage json"
systemctl is-active jrx-caselaw-embed-loop@0 jrx-caselaw-embed-loop@1 jrx-caselaw-embed-loop@2 jrx-caselaw-embed-dc jrx-embed-statutes-loop 2>/dev/null || true
pgrep -af embed-corpus.mjs | head -10 || true
tail -5 /opt/nyv/embed-stall.log 2>/dev/null || true
cd /opt/nyv/api && node --env-file=/opt/nyv/api/.env /opt/nyv/api/.jrx-embed-stall-probe.mjs 2>/dev/null || node --env-file=/opt/nyv/api/.env - <<'JS'
import { RDSClient, DescribeDBInstancesCommand } from "@aws-sdk/client-rds";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import pg from "pg";
const R = "ap-south-1";
const d = await new RDSClient({ region: R }).send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: "jrx-caselaw-pg" }));
const i = d.DBInstances?.[0];
const s = await new SecretsManagerClient({ region: R }).send(new GetSecretValueCommand({ SecretId: i.MasterUserSecret.SecretArn }));
const cr = JSON.parse(s.SecretString);
const c = new pg.Client({
  host: i.Endpoint.Address, port: i.Endpoint.Port ?? 5432, database: i.DBName ?? "nyv_caselaw",
  user: cr.username, password: cr.password, ssl: { rejectUnauthorized: false },
  statement_timeout: 120000, query_timeout: 120000,
});
await c.connect();
const r = await c.query(`SELECT scope, last_id, total_embedded, updated_at FROM embed_progress ORDER BY scope`);
for (const row of r.rows) console.log(`${row.scope}\tlast_id=${row.last_id}\tembedded=${row.total_embedded}\tupdated=${row.updated_at}`);
const counts = await c.query(`
  SELECT count(*) FILTER (WHERE embedding IS NOT NULL)::bigint AS embedded,
         count(*)::bigint AS total
    FROM judgments WHERE court_type IN ('sc','hc','dc')`);
const { embedded, total } = counts.rows[0];
console.log(`TOTAL\t${embedded}/${total}\t${(Number(embedded)/Number(total)*100).toFixed(2)}%\tunembedded=${Number(total)-Number(embedded)}`);
await c.end();
JS
