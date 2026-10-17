#!/usr/bin/env bash
# Measure rows/hour from embed_progress scope totals (no full COUNT).
set -uo pipefail
INTERVAL="${1:-600}"
cd /opt/nyv/api
INTERVAL_SEC="$INTERVAL" node --env-file=/opt/nyv/api/.env - <<'JS'
import { RDSClient, DescribeDBInstancesCommand } from "@aws-sdk/client-rds";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import pg from "pg";
const R = "ap-south-1";
const intervalSec = Number(process.env.INTERVAL_SEC || "600");
const SCOPES = ["hc:s0of3", "hc:s1of3", "hc:s2of3", "dc"];
async function snap(c) {
  const r = await c.query(
    `SELECT scope, total_embedded::bigint AS n, updated_at FROM embed_progress WHERE scope = ANY($1::text[]) ORDER BY scope`,
    [SCOPES],
  );
  const m = Object.fromEntries(r.rows.map((row) => [row.scope, Number(row.n)]));
  return { at: new Date().toISOString(), scopes: m, sum: Object.values(m).reduce((a, b) => a + b, 0) };
}
const d = await new RDSClient({ region: R }).send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: "nyv-caselaw-pg" }));
const i = d.DBInstances?.[0];
const s = await new SecretsManagerClient({ region: R }).send(new GetSecretValueCommand({ SecretId: i.MasterUserSecret.SecretArn }));
const cr = JSON.parse(s.SecretString);
const c = new pg.Client({
  host: i.Endpoint.Address, port: i.Endpoint.Port ?? 5432, database: i.DBName ?? "nyv_caselaw",
  user: cr.username, password: cr.password, ssl: { rejectUnauthorized: false },
  statement_timeout: 30000, query_timeout: 30000,
});
await c.connect();
const t0 = await snap(c);
console.log("T0", JSON.stringify(t0));
console.log("sleep_sec", intervalSec);
await new Promise((r) => setTimeout(r, intervalSec * 1000));
const t1 = await snap(c);
console.log("T1", JSON.stringify(t1));
const delta = t1.sum - t0.sum;
const hours = intervalSec / 3600;
const rph = hours > 0 ? Math.round(delta / hours) : 0;
console.log("delta_scope_embedded", delta, "rows_per_hour", rph);
for (const scope of SCOPES) {
  const d = (t1.scopes[scope] ?? 0) - (t0.scopes[scope] ?? 0);
  if (d) console.log("  ", scope, "+", d);
}
await c.end();
JS
