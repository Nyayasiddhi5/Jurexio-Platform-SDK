#!/usr/bin/env bash
# Query case_api_search RDS DB used by nysapi (read-only). NV-SECRETS-001.
set -uo pipefail
cd /opt/nyv/api || exit 1
echo "=== CASE_API_SEARCH PROBE $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="

pid=$(pgrep -f 'uvicorn.*8090' | head -1 || true)
if [ -n "$pid" ] && [ -r "/proc/$pid/environ" ]; then
  python3 <<'PY'
import re, subprocess
pid = subprocess.check_output(["pgrep","-f","uvicorn.*8090"]).decode().split()[0]
for e in open(f"/proc/{pid}/environ","rb").read().split(b"\0"):
    if b"=" not in e: continue
    k,v = e.split(b"=",1); k=k.decode(); v=v.decode()
    if not any(x in k for x in ("CASE_API","TABLE","RDS","ENGINE","LOOKUP","EVENTS")): continue
    if "KEY" in k or "SECRET" in k or "PASSWORD" in k:
        print(f"{k}=***REDACTED*** len={len(v)}")
    elif "://" in v and "@" in v:
        print(f"{k}={re.sub(r':([^:@/]+)@', ':***@', v)[:180]}")
    else:
        print(f"{k}={v[:180]}")
PY
fi

node --env-file=/opt/nyv/api/.env <<'NODE'
import { readFileSync, existsSync } from "node:fs";
import pg from "pg";
import { RDSClient, DescribeDBInstancesCommand } from "@aws-sdk/client-rds";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

const REGION = "ap-south-1";
const DB_NAME = "case_api_search";

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

// Try case_api_ro from Secrets Manager if separate secret exists
let roUser = creds.username;
let roPass = creds.password;
try {
  const ro = JSON.parse((await new SecretsManagerClient({ region: REGION }).send(new GetSecretValueCommand({ SecretId: "nyaya/case_api/rds-ro" }))).SecretString ?? "{}");
  if (ro.username) { roUser = ro.username; roPass = ro.password; }
} catch (_) {}

const pool = new pg.Pool({
  host: inst.Endpoint.Address, port: inst.Endpoint.Port ?? 5432,
  database: DB_NAME, user: roUser, password: roPass,
  ssl: ssl(), max: 2, statement_timeout: 120000,
});

console.log("DB", DB_NAME, "connected");

await q(pool, "TABLES", `
  SELECT table_name FROM information_schema.tables
  WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY 1
`);

await q(pool, "COLS_ALL", `
  SELECT table_name, column_name, data_type FROM information_schema.columns
  WHERE table_schema='public'
    AND column_name IN ('cnr','diary_no','case_number','court_level','decision_date','filing_date','updated_at','source_synced_at','registration_date')
  ORDER BY table_name, column_name
`);

// Discover primary lookup table (has diary_no)
const tblRes = await pool.query(`
  SELECT DISTINCT table_name FROM information_schema.columns
  WHERE table_schema='public' AND column_name='diary_no'
`);
const diaryTables = tblRes.rows.map(r => r.table_name);
console.log("DIARY_TABLES", JSON.stringify(diaryTables));

for (const tbl of diaryTables.length ? diaryTables : ["case_lookup"]) {
  await q(pool, `STATS_${tbl}`, `
    SELECT court_level,
      count(*)::bigint AS total,
      count(*) FILTER (WHERE cnr IS NOT NULL AND btrim(cnr::text) <> '')::bigint AS with_cnr,
      count(*) FILTER (WHERE diary_no IS NOT NULL AND btrim(diary_no::text) <> '')::bigint AS with_diary,
      max(decision_date)::text AS max_decision,
      max(filing_date)::text AS max_filing,
      max(updated_at)::text AS max_updated,
      max(source_synced_at)::text AS max_synced
    FROM ${tbl}
    GROUP BY court_level ORDER BY court_level
  `);

  for (const cl of ["SC","HC","DC"]) {
    await q(pool, `LATEST3_${tbl}_${cl}`, `
      SELECT left(cnr::text,20) AS cnr, diary_no, left(case_number::text,40) AS case_number,
             court_level, decision_date::text AS decision_date, updated_at::text AS updated_at
      FROM ${tbl} WHERE court_level = $1
      ORDER BY updated_at DESC NULLS LAST, decision_date DESC NULLS LAST
      LIMIT 3
    `, [cl]);
  }

  const DIARIES = ["17329/2025","50850/2026","45155/2024","44418/2026","40531/2026",
    "7319/2026","46024/2024","46771/2026","25293/2024","46569/2024"];
  for (const d of DIARIES) {
    await q(pool, `USER_${d.replace(/\//g,'_')}`, `
      SELECT left(cnr::text,20) AS cnr, diary_no, left(case_number::text,40) AS case_number, court_level
      FROM ${tbl} WHERE diary_no = $1 LIMIT 1
    `, [d]);
  }
}

// case_events table if exists
const evRes = await pool.query(`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema='public' AND table_name ILIKE '%event%'
`);
for (const row of evRes.rows) {
  await q(pool, `EVENTS_COUNT_${row.table_name}`, `SELECT count(*)::bigint AS n FROM ${row.table_name}`);
}

await pool.end();
NODE

echo "=== CASE_API_SEARCH DONE ==="
