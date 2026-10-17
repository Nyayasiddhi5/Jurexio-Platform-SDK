#!/usr/bin/env bash
# Fast supplemental freshness — avoids full-table GROUP BY on 26M rows.
set -uo pipefail
cd /opt/nyv/api || exit 1
echo "=== FRESHNESS FAST $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="

node --env-file=/opt/nyv/api/.env <<'NODE'
import { readFileSync, existsSync } from "node:fs";
import pg from "pg";
import { RDSClient, DescribeDBInstancesCommand } from "@aws-sdk/client-rds";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

const REGION = "ap-south-1";
function ssl() {
  const p = process.env.RDS_CA_BUNDLE;
  if (p && existsSync(p)) return { rejectUnauthorized: true, ca: readFileSync(p, "utf8") };
  return { rejectUnauthorized: false };
}
const rds = new RDSClient({ region: REGION });
const desc = await rds.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: "jrx-caselaw-pg" }));
const inst = desc.DBInstances[0];
const sm = new SecretsManagerClient({ region: REGION });
const secret = await sm.send(new GetSecretValueCommand({ SecretId: inst.MasterUserSecret.SecretArn }));
const creds = JSON.parse(secret.SecretString);
const pool = new pg.Pool({
  host: inst.Endpoint.Address,
  port: inst.Endpoint.Port ?? 5432,
  database: inst.DBName ?? "nyv_caselaw",
  user: creds.username,
  password: creds.password,
  ssl: ssl(),
  max: 2,
  statement_timeout: 180000,
});

async function q(label, sql, params = []) {
  const t0 = Date.now();
  try {
    const r = await pool.query(sql, params);
    console.log(label, "ms", Date.now() - t0, JSON.stringify(r.rows));
  } catch (e) {
    console.log(label, "ERR", String(e.message).slice(0, 120), "ms", Date.now() - t0);
  }
}

// Fast counts from corpus-counts pattern
await q("CORPUS_COUNTS", `
  SELECT court_type,
    count(*)::bigint AS total,
    count(*) FILTER (WHERE body_search_tsv IS NOT NULL)::bigint AS body_fts,
    count(*) FILTER (WHERE embedding IS NOT NULL)::bigint AS embedded
  FROM judgments WHERE court_type IN ('sc','hc','dc')
  GROUP BY court_type ORDER BY court_type
`);

// CNR rate via partial counts (sequential per court — uses index if present)
for (const ct of ["sc", "hc", "dc"]) {
  await q(`CNR_${ct.toUpperCase()}`, `
    SELECT count(*)::bigint AS total,
      count(*) FILTER (WHERE cnr IS NOT NULL AND btrim(cnr) <> '')::bigint AS with_cnr
    FROM judgments WHERE court_type = $1
  `, [ct]);
}

// Max decision_date per court — single aggregate per partition
for (const ct of ["sc", "hc", "dc"]) {
  await q(`MAX_DECISION_${ct.toUpperCase()}`, `
    SELECT max(decision_date)::text AS max_decision, max(year)::int AS max_year
    FROM judgments WHERE court_type = $1
  `, [ct]);
}

// Recent ingest via created_at (year filter for HC/DC speed)
for (const ct of ["sc", "hc", "dc"]) {
  const yrFilter = ct === "sc" ? "" : " AND year >= 2024";
  await q(`MAX_CREATED_${ct.toUpperCase()}`, `
    SELECT max(created_at)::text AS max_created
    FROM judgments WHERE court_type = $1${yrFilter}
  `, [ct]);
}

// Latest filing in cnr_case_details
await q("CNR_FILING_MAX", `
  SELECT max(filing_date)::text AS max_filing, max(decision_date)::text AS max_decision
  FROM cnr_case_details
`);

// SC diary samples from case_no index
await q("SC_DIARY_SAMPLES", `
  SELECT case_no, cnr, left(title,60) AS title
  FROM judgments
  WHERE court_type='sc' AND case_no ~ '^[0-9]+/[0-9]{4}$'
  ORDER BY id DESC LIMIT 5
`);

await pool.end();
NODE

echo "=== FAST DONE ==="
