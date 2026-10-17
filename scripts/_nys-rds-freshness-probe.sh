#!/usr/bin/env bash
# NV-NYSAPI-RDS-FRESHNESS-001 — read-only RDS + nysapi freshness per court type (SC/HC/DC).
# Runs ON caselaw-worker. NV-SECRETS-001: no secret values in output.
set -uo pipefail
cd /opt/nyv/api || exit 1

echo "=== NV-NYSAPI-RDS-FRESHNESS-001 $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo "host=$(hostname -s 2>/dev/null || echo worker)"
echo "rds_instance=nyv-caselaw-pg"

node --env-file=/opt/nyv/api/.env <<'NODE'
import { readFileSync, existsSync } from "node:fs";
import pg from "pg";
import { RDSClient, DescribeDBInstancesCommand } from "@aws-sdk/client-rds";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

const REGION = "ap-south-1";
const DB_ID = "nyv-caselaw-pg";

function ssl() {
  const p = process.env.RDS_CA_BUNDLE;
  if (p && existsSync(p)) return { rejectUnauthorized: true, ca: readFileSync(p, "utf8") };
  return { rejectUnauthorized: false };
}

const rds = new RDSClient({ region: REGION });
const desc = await rds.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: DB_ID }));
const inst = desc.DBInstances?.[0];
const sm = new SecretsManagerClient({ region: REGION });
const secret = await sm.send(new GetSecretValueCommand({ SecretId: inst.MasterUserSecret.SecretArn }));
const creds = JSON.parse(secret.SecretString ?? "{}");
const dbName = inst.DBName ?? "nyv_caselaw";
console.log("RDS_DB", dbName, "endpoint_len", (inst.Endpoint?.Address ?? "").length);

const pool = new pg.Pool({
  host: inst.Endpoint.Address,
  port: inst.Endpoint.Port ?? 5432,
  database: dbName,
  user: creds.username,
  password: creds.password,
  ssl: ssl(),
  max: 2,
  statement_timeout: 120000,
});

async function safeQuery(label, sql, params = []) {
  const t0 = Date.now();
  try {
    const r = await pool.query(sql, params);
    console.log(label, "ms", Date.now() - t0, JSON.stringify(r.rows));
    return r.rows;
  } catch (e) {
    console.log(label, "ERR", String(e.message).slice(0, 160), "ms", Date.now() - t0);
    return null;
  }
}

// Column discovery for timestamps
await safeQuery("JUDGMENTS_TS_COLS", `
  SELECT column_name, data_type
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='judgments'
    AND column_name IN ('decision_date','created_at','updated_at','ingested_at','synced_at','year')
  ORDER BY column_name
`);

// Per court type corpus stats
await safeQuery("CORPUS_BY_COURT", `
  SELECT court_type,
    count(*)::bigint AS total,
    count(*) FILTER (WHERE cnr IS NOT NULL AND btrim(cnr) <> '')::bigint AS with_cnr,
    round(100.0 * count(*) FILTER (WHERE cnr IS NOT NULL AND btrim(cnr) <> '') / NULLIF(count(*),0), 2) AS cnr_pct,
    count(*) FILTER (WHERE embedding IS NOT NULL)::bigint AS embedded,
    round(100.0 * count(*) FILTER (WHERE embedding IS NOT NULL) / NULLIF(count(*),0), 2) AS embed_pct,
    count(*) FILTER (WHERE body_search_tsv IS NOT NULL)::bigint AS body_fts,
    max(decision_date)::text AS latest_decision_date,
    max(year)::int AS max_year,
    min(year)::int AS min_year
  FROM judgments
  WHERE court_type IN ('sc','hc','dc')
  GROUP BY court_type
  ORDER BY court_type
`);

// Latest rows per court (by decision_date then id)
for (const ct of ["sc", "hc", "dc"]) {
  await safeQuery(`LATEST_${ct.toUpperCase()}`, `
    SELECT id, left(cnr, 20) AS cnr, court, year, decision_date::text AS decision_date,
           left(title, 80) AS title, source
    FROM judgments
    WHERE court_type = $1
    ORDER BY decision_date DESC NULLS LAST, id DESC
    LIMIT 3
  `, [ct]);
}

// Source breakdown per court
await safeQuery("SOURCE_BREAKDOWN", `
  SELECT court_type, coalesce(nullif(source,''), '(null)') AS source, count(*)::bigint AS n
  FROM judgments
  WHERE court_type IN ('sc','hc','dc')
  GROUP BY court_type, coalesce(nullif(source,''), '(null)')
  ORDER BY court_type, n DESC
  LIMIT 30
`);

// ingest_progress checkpoints (latest partitions)
await safeQuery("INGEST_PROGRESS_TOP", `
  SELECT partition_key, row_count
  FROM ingest_progress
  ORDER BY partition_key DESC
  LIMIT 20
`);

await safeQuery("INGEST_PROGRESS_BY_PREFIX", `
  SELECT split_part(partition_key, '/', 1) AS prefix,
    count(*)::int AS partitions,
    sum(row_count)::bigint AS sum_rows,
    max(partition_key) AS latest_key
  FROM ingest_progress
  GROUP BY split_part(partition_key, '/', 1)
  ORDER BY prefix
`);

// cnr_case_details stats
await safeQuery("CNR_DETAILS_TOTAL", `
  SELECT count(*)::bigint AS total,
    max(updated_at)::text AS latest_updated_at,
    max(synced_at)::text AS latest_synced_at,
    max(filing_date)::text AS latest_filing_date,
    max(decision_date)::text AS latest_decision_date
  FROM cnr_case_details
`);

await safeQuery("CNR_DETAILS_BY_COURT_CODE", `
  SELECT left(court_code, 4) AS court_prefix,
    count(*)::bigint AS n,
    max(filing_date)::text AS latest_filing,
    max(decision_date)::text AS latest_decision,
    max(updated_at)::text AS latest_updated
  FROM cnr_case_details
  WHERE court_code IS NOT NULL
  GROUP BY left(court_code, 4)
  ORDER BY n DESC
  LIMIT 15
`);

await safeQuery("CNR_DETAILS_SOURCE", `
  SELECT source, count(*)::bigint AS n, max(updated_at)::text AS latest_updated
  FROM cnr_case_details
  GROUP BY source
  ORDER BY n DESC
  LIMIT 10
`);

// Diary index coverage (case_no slash pattern)
await safeQuery("DIARY_INDEX", `
  SELECT court_type,
    count(*) FILTER (WHERE case_no ~ '^[0-9]+/[0-9]{4}$')::bigint AS diary_pattern_rows
  FROM judgments
  WHERE court_type IN ('sc','hc','dc')
  GROUP BY court_type
  ORDER BY court_type
`);

// created_at max if column exists
const hasCreated = await pool.query(`
  SELECT 1 FROM information_schema.columns
  WHERE table_schema='public' AND table_name='judgments' AND column_name='created_at'
  LIMIT 1
`);
if (hasCreated.rowCount > 0) {
  await safeQuery("LATEST_INGEST_CREATED_AT", `
    SELECT court_type, max(created_at)::text AS latest_created_at
    FROM judgments
    WHERE court_type IN ('sc','hc','dc')
    GROUP BY court_type ORDER BY court_type
  `);
}

await pool.end();
NODE

echo "=== LOCAL NYS API (:8080) ==="
curl -sS -m 5 -w " healthz http=%{http_code} ms=%{time_total}\n" http://127.0.0.1:8080/healthz 2>/dev/null | head -c 200 || echo healthz_fail

echo "=== EMBED UNITS ==="
for u in nyv-caselaw-embed-loop@{0,1,2} nyv-caselaw-embed-dc; do
  echo "$u: $(systemctl is-active $u 2>/dev/null || echo inactive)"
done

echo "=== WEEKLY REFRESH LOG (tail) ==="
tail -5 /opt/nyv/logs/weekly-india-refresh.log 2>/dev/null || \
  tail -5 /var/log/weekly-india-refresh.log 2>/dev/null || echo no_weekly_log

echo "=== ATHENA TABLE COUNTS (if env set) ==="
node --env-file=/opt/nyv/api/.env <<'NODE'
import {
  AthenaClient,
  StartQueryExecutionCommand,
  GetQueryExecutionCommand,
  GetQueryResultsCommand,
} from "@aws-sdk/client-athena";

const db = process.env.ATHENA_DATABASE || "nyv_docs";
const out = process.env.ATHENA_OUTPUT || "s3://usa-caselaw/athena/results/";
const client = new AthenaClient({ region: process.env.AWS_REGION || "ap-south-1" });

async function countTable(table) {
  const t0 = Date.now();
  try {
    const start = await client.send(
      new StartQueryExecutionCommand({
        QueryString: `SELECT COUNT(*) AS n FROM ${db}.${table}`,
        QueryExecutionContext: { Database: db },
        ResultConfiguration: { OutputLocation: out },
      }),
    );
    const id = start.QueryExecutionId;
    for (let i = 0; i < 45; i++) {
      const g = await client.send(new GetQueryExecutionCommand({ QueryExecutionId: id }));
      const st = g.QueryExecution?.Status?.State;
      if (st === "SUCCEEDED" || st === "FAILED" || st === "CANCELLED") break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    const res = await client.send(new GetQueryResultsCommand({ QueryExecutionId: id }));
    const val = res.ResultSet?.Rows?.[1]?.Data?.[0]?.VarCharValue ?? "?";
    console.log("ATHENA", table, "rows", val, "ms", Date.now() - t0);
  } catch (e) {
    console.log("ATHENA", table, "ERR", String(e.message).slice(0, 100));
  }
}

const tables = [
  process.env.ATHENA_TABLE_SC_CASE_DETAILS || "judgments_meta_sc_case_details",
  process.env.ATHENA_TABLE_HC_CASE_DETAILS || "judgments_meta_hc_case_details",
  process.env.ATHENA_TABLE_DC_CASE_DETAILS || "judgments_meta_dc_case_details",
];
for (const t of tables) await countTable(t);
NODE

echo "=== PROBE DONE ==="
