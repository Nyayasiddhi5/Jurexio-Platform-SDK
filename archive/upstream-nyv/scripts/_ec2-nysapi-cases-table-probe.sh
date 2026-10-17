#!/usr/bin/env bash
# Probe case_api_search.cases + DuckDB lookup files. NV-SECRETS-001.
set -uo pipefail
cd /opt/nyv/api || exit 1
echo "=== CASES TABLE + DUCKDB PROBE $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="

echo "=== DUCKDB BUILD FILES ==="
for p in /home/ubuntu/scripts/case_api/_build/case_lookup_full /home/ubuntu/scripts/case_api/_build/case_events; do
  if [ -d "$p" ]; then
    echo "DIR $p files=$(find "$p" -type f 2>/dev/null | wc -l | tr -d ' ') size=$(du -sh "$p" 2>/dev/null | cut -f1)"
    ls -la "$p" 2>/dev/null | head -5
  elif [ -f "$p" ]; then
    echo "FILE $p size=$(stat -c%s "$p" 2>/dev/null || stat -f%z "$p")"
  else
    echo "MISSING $p"
  fi
done

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
async function q(pool, label, sql, params = []) {
  const t0 = Date.now();
  try {
    const r = await pool.query(sql, params);
    console.log(label, "ms", Date.now() - t0, JSON.stringify(r.rows));
  } catch (e) {
    console.log(label, "ERR", String(e.message).slice(0, 160), "ms", Date.now() - t0);
  }
}

const rds = new RDSClient({ region: REGION });
const inst = (await rds.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: "nyv-caselaw-pg" }))).DBInstances[0];
const creds = JSON.parse((await new SecretsManagerClient({ region: REGION }).send(new GetSecretValueCommand({ SecretId: inst.MasterUserSecret.SecretArn }))).SecretString);
let roUser = creds.username, roPass = creds.password;
try {
  const ro = JSON.parse((await new SecretsManagerClient({ region: REGION }).send(new GetSecretValueCommand({ SecretId: "nyaya/case_api/rds-ro" }))).SecretString ?? "{}");
  if (ro.username) { roUser = ro.username; roPass = ro.password; }
} catch (_) {}

const pool = new pg.Pool({
  host: inst.Endpoint.Address, port: inst.Endpoint.Port ?? 5432,
  database: "case_api_search", user: roUser, password: roPass,
  ssl: ssl(), max: 2, statement_timeout: 180000,
});

await q(pool, "ALL_OBJECTS", `
  SELECT table_schema, table_name, table_type
  FROM information_schema.tables
  WHERE table_schema NOT IN ('pg_catalog','information_schema')
  ORDER BY table_type, table_name
`);

for (const tbl of ["cases", "case_summaries", "cases_search_staging", "rds_load_state"]) {
  await q(pool, `COUNT_${tbl}`, `SELECT count(*)::bigint AS n FROM ${tbl}`);
}

await q(pool, "CASES_BY_COURT", `
  SELECT court_level,
    count(*)::bigint AS total,
    count(*) FILTER (WHERE cnr IS NOT NULL AND btrim(cnr::text) <> '')::bigint AS with_cnr,
    max(decision_date)::text AS max_decision,
    max(filing_date)::text AS max_filing,
    max(source_synced_at)::text AS max_synced
  FROM cases
  GROUP BY court_level ORDER BY court_level
`);

for (const cl of ["SC","HC","DC"]) {
  await q(pool, `CASES_LATEST_${cl}`, `
    SELECT left(cnr::text,20) AS cnr, left(case_number::text,40) AS case_number,
           court_level, decision_date::text AS decision_date, source_synced_at::text AS synced
    FROM cases WHERE court_level = $1
    ORDER BY source_synced_at DESC NULLS LAST, decision_date DESC NULLS LAST
    LIMIT 3
  `, [cl]);
}

// Check if diary stored in case_number or extra column
await q(pool, "CASES_DIARY_PATTERN", `
  SELECT count(*)::bigint AS diary_in_case_number
  FROM cases
  WHERE case_number ~ '^[0-9]+/[0-9]{4}$'
`);

await q(pool, "RDS_LOAD_STATE", `SELECT * FROM rds_load_state ORDER BY 1`);

await pool.end();
NODE

# DuckDB query via python if available
python3 <<'PY' 2>/dev/null || echo "DUCKDB_PY_SKIP"
import os, glob
try:
    import duckdb
except ImportError:
    print("DUCKDB_IMPORT skip"); raise SystemExit(0)

lookup = "/home/ubuntu/scripts/case_api/_build/case_lookup_full"
paths = []
if os.path.isdir(lookup):
    paths = glob.glob(lookup + "/**/*.parquet", recursive=True) or glob.glob(lookup + "/*")
elif os.path.isfile(lookup):
    paths = [lookup]

if not paths:
    print("DUCKDB_NO_FILES"); raise SystemExit(0)

con = duckdb.connect(":memory:")
# try read parquet directory
try:
    con.execute(f"CREATE TABLE lk AS SELECT * FROM read_parquet('{lookup}/**/*.parquet', union_by_name=true)")
except Exception:
    try:
        con.execute(f"CREATE TABLE lk AS SELECT * FROM read_parquet('{lookup}')")
    except Exception as e:
        print("DUCKDB_READ_ERR", str(e)[:120]); raise SystemExit(0)

cols = [r[0] for r in con.execute("DESCRIBE lk").fetchall()]
print("DUCKDB_COLS", cols[:20])

if "diary_no" in cols:
    stats = con.execute("""
        SELECT court_level, count(*) AS total,
          count(cnr) FILTER (WHERE cnr IS NOT NULL AND cnr <> '') AS with_cnr,
          count(diary_no) FILTER (WHERE diary_no IS NOT NULL AND diary_no <> '') AS with_diary,
          max(source_synced_at) AS max_synced
        FROM lk GROUP BY court_level ORDER BY court_level
    """).fetchall()
    print("DUCKDB_STATS", stats)

    for d in ["17329/2025","50850/2026","25293/2024"]:
        row = con.execute("SELECT cnr, diary_no, case_number, court_level FROM lk WHERE diary_no = ? LIMIT 1", [d]).fetchone()
        print(f"DUCKDB_DIARY_{d.replace('/','_')}", row)
else:
    print("DUCKDB_NO_DIARY_COL")
PY

echo "=== CASES PROBE DONE ==="
