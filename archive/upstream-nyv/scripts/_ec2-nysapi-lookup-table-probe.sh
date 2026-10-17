#!/usr/bin/env bash
# Discover nysapi case-api lookup table names + sample diary rows (no secrets).
set -uo pipefail
echo "=== NYSAPI LOOKUP TABLE PROBE $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="

pid=$(pgrep -f 'uvicorn.*8090' | head -1 || true)
if [ -z "$pid" ] || [ ! -r "/proc/$pid/environ" ]; then
  echo "uvicorn_not_running"; exit 1
fi

# Print table URI shapes (redact credentials in DSN)
python3 <<'PY'
import os, re, subprocess
pid = subprocess.check_output(["pgrep","-f","uvicorn.*8090"]).decode().split()[0]
env = open(f"/proc/{pid}/environ","rb").read().split(b"\0")
vals = {}
for e in env:
    if b"=" in e:
        k,v = e.split(b"=",1)
        vals[k.decode()] = v.decode()

for k in sorted(vals):
    if not any(x in k for x in ("CASE_API","TABLE","RDS","ENGINE","LOOKUP","EVENTS")):
        continue
    v = vals[k]
    if "KEY" in k or "SECRET" in k or "PASSWORD" in k:
        print(f"{k}=***REDACTED*** len={len(v)}")
        continue
    if "://" in v and "@" in v:
        v = re.sub(r":([^:@/]+)@", ":***@", v)
    print(f"{k}={v[:200]}")
PY

# Query lookup table via case-api RDS if table name parseable
node --env-file=/opt/nyv/api/.env <<'NODE'
import { readFileSync, existsSync } from "node:fs";
import pg from "pg";
import { execSync } from "node:child_process";

const pid = execSync("pgrep -f 'uvicorn.*8090'").toString().trim().split("\n")[0];
const envRaw = readFileSync(`/proc/${pid}/environ`);
const env = {};
for (const e of envRaw.toString("binary").split("\0")) {
  const i = e.indexOf("=");
  if (i > 0) env[e.slice(0, i)] = e.slice(i + 1);
}

const lookupUri = env.CASE_API_LOOKUP_TABLE_URI ?? "";
const eventsUri = env.CASE_API_CASE_EVENTS_TABLE_URI ?? "";
const rdsDsn = env.CASE_API_RDS_DSN ?? "";
console.log("PARSED lookup_uri", lookupUri.replace(/:[^:@/]+@/, ":***@").slice(0, 120));
console.log("PARSED events_uri", eventsUri.replace(/:[^:@/]+@/, ":***@").slice(0, 120));

function parsePgTable(uri) {
  // postgresql://user:pass@host:5432/db?options=-csearch_path=public#table_name
  // or table=sc_case_lookup
  const m = uri.match(/[#?](?:table=)?([a-z_][a-z0-9_]*)/i);
  if (m) return m[1];
  const hash = uri.split("#")[1];
  if (hash && /^[a-z_]/i.test(hash)) return hash;
  const path = uri.split("/").pop()?.split("?")[0];
  if (path && /^[a-z_][a-z0-9_]*$/i.test(path)) return path;
  return null;
}

const tableName = parsePgTable(lookupUri) ?? parsePgTable(rdsDsn);
console.log("GUESSED_TABLE", tableName);

async function connectFromDsn(dsn) {
  const { RDSClient, DescribeDBInstancesCommand } = await import("@aws-sdk/client-rds");
  const { SecretsManagerClient, GetSecretValueCommand } = await import("@aws-sdk/client-secrets-manager");
  const REGION = "ap-south-1";
  function ssl() {
    const p = process.env.RDS_CA_BUNDLE;
    if (p && existsSync(p)) return { rejectUnauthorized: true, ca: readFileSync(p, "utf8") };
    return { rejectUnauthorized: false };
  }
  const rds = new RDSClient({ region: REGION });
  const inst = (await rds.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: "nyv-caselaw-pg" }))).DBInstances[0];
  const creds = JSON.parse((await new SecretsManagerClient({ region: REGION }).send(new GetSecretValueCommand({ SecretId: inst.MasterUserSecret.SecretArn }))).SecretString);
  return new pg.Pool({
    host: inst.Endpoint.Address, port: inst.Endpoint.Port ?? 5432,
    database: inst.DBName ?? "nyv_caselaw", user: creds.username, password: creds.password,
    ssl: ssl(), max: 2, statement_timeout: 60000,
  });
}

const pool = await connectFromDsn(rdsDsn || lookupUri);

// List all tables with diary_no column
const cols = await pool.query(`
  SELECT table_name, column_name, data_type
  FROM information_schema.columns
  WHERE table_schema='public'
    AND column_name IN ('diary_no','court_level','case_number','cnr','updated_at','source_synced_at')
  ORDER BY table_name, column_name
`);
console.log("COLS_DIARY", JSON.stringify(cols.rows));

// Find tables with diary_no
const diaryTables = [...new Set(cols.rows.filter(r => r.column_name === 'diary_no').map(r => r.table_name))];
console.log("DIARY_TABLES", JSON.stringify(diaryTables));

for (const tbl of diaryTables.length ? diaryTables : (tableName ? [tableName] : [])) {
  try {
    const stats = await pool.query(`
      SELECT court_level,
        count(*)::bigint AS total,
        count(*) FILTER (WHERE cnr IS NOT NULL AND btrim(cnr::text) <> '')::bigint AS with_cnr,
        count(*) FILTER (WHERE diary_no IS NOT NULL AND btrim(diary_no::text) <> '')::bigint AS with_diary,
        max(updated_at)::text AS max_updated,
        max(source_synced_at)::text AS max_synced
      FROM ${tbl}
      GROUP BY court_level ORDER BY court_level
    `);
    console.log(`STATS_${tbl}`, JSON.stringify(stats.rows));
  } catch (e) {
    console.log(`STATS_${tbl}_ERR`, String(e.message).slice(0, 100));
  }

  for (const d of ["17329/2025","50850/2026","25293/2024"]) {
    try {
      const r = await pool.query(`
        SELECT left(cnr::text,20) AS cnr, diary_no, left(case_number::text,40) AS case_number, court_level
        FROM ${tbl} WHERE diary_no = $1 LIMIT 1
      `, [d]);
      console.log(`DIARY_${tbl}_${d.replace(/\//g,'_')}`, JSON.stringify(r.rows));
    } catch (e) {
      console.log(`DIARY_${tbl}_ERR`, String(e.message).slice(0, 80));
      break;
    }
  }

  try {
    const latest = await pool.query(`
      SELECT left(cnr::text,20) AS cnr, diary_no, left(case_number::text,40) AS case_number, court_level,
             updated_at::text AS updated_at
      FROM ${tbl}
      WHERE court_level = 'SC'
      ORDER BY updated_at DESC NULLS LAST
      LIMIT 3
    `);
    console.log(`LATEST_SC_${tbl}`, JSON.stringify(latest.rows));
  } catch (_) {}
}

await pool.end();
NODE

echo "=== LOOKUP PROBE DONE ==="
