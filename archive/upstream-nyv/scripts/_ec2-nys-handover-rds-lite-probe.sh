#!/usr/bin/env bash
# NV-NYS-HANDOVER-RDS-LITE — fast stats via pg_class + targeted queries (no full scans).
set -uo pipefail
cd /opt/nyv/api || exit 1
echo "=== NV-NYS-HANDOVER-RDS-LITE $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="

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
const inst = (await rds.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: "nyv-caselaw-pg" }))).DBInstances[0];
const creds = JSON.parse((await new SecretsManagerClient({ region: REGION }).send(new GetSecretValueCommand({ SecretId: inst.MasterUserSecret.SecretArn }))).SecretString);

async function q(pool, label, sql, params = []) {
  const t0 = Date.now();
  try {
    const r = await pool.query(sql, params);
    console.log(label, "ms", Date.now() - t0, JSON.stringify(r.rows));
  } catch (e) {
    console.log(label, "ERR", String(e.message).slice(0, 160), "ms", Date.now() - t0);
  }
}

const pgPool = new pg.Pool({
  host: inst.Endpoint.Address, port: inst.Endpoint.Port ?? 5432,
  database: "postgres", user: creds.username, password: creds.password,
  ssl: ssl(), max: 2, statement_timeout: 60000,
});
await q(pgPool, "DATABASES", `
  SELECT datname FROM pg_database WHERE datistemplate=false AND datname NOT IN ('rdsadmin') ORDER BY 1
`);
await pgPool.end();

for (const db of ["case_api_search", "nyv_caselaw"]) {
  const pool = new pg.Pool({
    host: inst.Endpoint.Address, port: inst.Endpoint.Port ?? 5432,
    database: db, user: creds.username, password: creds.password,
    ssl: ssl(), max: 2, statement_timeout: 120000,
  });
  console.log("===", db, "===");
  await q(pool, "TABLE_ESTIMATES", `
    SELECT relname AS table_name, reltuples::bigint AS est_rows
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r'
    ORDER BY reltuples DESC LIMIT 15
  `);

  if (db === "case_api_search") {
    await q(pool, "RDS_LOAD_STATE", `SELECT table_version, applied_at::text FROM rds_load_state ORDER BY applied_at DESC LIMIT 1`);
    await q(pool, "STAGING_COLS", `
      SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='cases_search_staging'
      ORDER BY ordinal_position
    `);
    await q(pool, "DIARY_COL_EXISTS", `
      SELECT count(*)::int AS n FROM information_schema.columns
      WHERE table_schema='public' AND column_name='diary_no'
    `);
    for (const cl of ["SC","HC","DC"]) {
      await q(pool, `STAGING_${cl}`, `
        SELECT court_level, count(*)::bigint AS n FROM cases_search_staging
        WHERE court_level=$1 GROUP BY 1
      `, [cl]);
    }
    for (const spec of ["HC|TSWL000000742024","HC|GJHC240256342024","DC|DLCT010000012024","DC|DLCT010043082025"]) {
      const [cl, cnr] = spec.split("|");
      await q(pool, `LOOKUP_${cnr.slice(0,8)}`, `
        SELECT left(cnr,20) AS cnr, court_level, left(case_number,40) AS case_number,
               filing_date::text, decision_date::text
        FROM cases_search_staging WHERE cnr=$1 LIMIT 1
      `, [cnr]);
    }
  }

  if (db === "nyv_caselaw") {
    await q(pool, "CNR_DETAILS_EST", `
      SELECT count(*)::bigint AS total, max(updated_at)::text AS max_updated FROM cnr_case_details
    `);
    await q(pool, "SC_DIARY_SAMPLE", `
      SELECT case_no, left(cnr,20) AS cnr, left(title,40) AS title, year
      FROM judgments WHERE court_type='sc' AND case_no ~ '^[0-9]+/[0-9]{4}$'
      ORDER BY year DESC LIMIT 3
    `);
    for (const d of ["17329/2025","50850/2026"]) {
      await q(pool, `DIARY_J_${d.replace(/\//g,"_")}`, `
        SELECT id, left(cnr,20) AS cnr, case_no FROM judgments
        WHERE court_type='sc' AND case_no=$1 LIMIT 1
      `, [d]);
    }
    await q(pool, "HC_DC_DIARY_PATTERN", `
      SELECT court_type, count(*)::bigint AS diary_rows
      FROM judgments WHERE court_type IN ('hc','dc') AND case_no ~ '^[0-9]+/[0-9]{4}$'
      GROUP BY court_type
    `);
  }
  await pool.end();
}
NODE

pid=$(pgrep -f 'uvicorn.*8090' | head -1 || true)
KEY=""
[ -n "$pid" ] && [ -r "/proc/$pid/environ" ] && KEY=$(tr '\0' '\n' < "/proc/$pid/environ" | grep '^CASE_API_API_KEYS=' | head -1 | cut -d= -f2- | cut -d, -f1)
echo "key_len=$(printf %s "$KEY" | wc -c | tr -d ' ')"
if [ "$(printf %s "$KEY" | wc -c)" -gt 8 ]; then
  for spec in "SC_DIARY|http://127.0.0.1:8090/v1/cases?court_type=SC&diary_no=17329%2F2025&page_size=1" \
              "HC_DIARY_400|http://127.0.0.1:8090/v1/cases?court_type=HC&diary_no=17329%2F2025" \
              "DC_DIARY_400|http://127.0.0.1:8090/v1/cases?court_type=DC&diary_no=17329%2F2025" \
              "CNR_GJHC|http://127.0.0.1:8090/v1/cases/GJHC240256342024" \
              "CNR_DLCT|http://127.0.0.1:8090/v1/cases/DLCT010000012024" \
              "TIMELINE|http://127.0.0.1:8090/v1/cases/GJHC240256342024/timeline"; do
    label="${spec%%|*}"; url="${spec##*|}"
    tmp=$(mktemp)
    http=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time 45 -H "X-API-Key: $KEY" "$url" 2>/dev/null || echo ERR)
    python3 - "$label" "$http" "$tmp" <<'PY'
import json,sys
label,http,path=sys.argv[1:4]
try:
  d=json.load(open(path))
  if d.get("cases") is not None:
    c=(d["cases"] or [{}])[0]
    print(f"API {label} http={http} cnr={c.get('cnr')!r} diary={c.get('diary_no')!r} case_no={str(c.get('case_number',''))[:30]!r} court={c.get('court_level')!r}")
  elif d.get("case"):
    c=d["case"]
    print(f"API {label} http={http} cnr={c.get('cnr')!r} hearings={len(c.get('hearings') or [])} backend={(c.get('provenance') or {}).get('backend')!r}")
  elif d.get("events") is not None:
    print(f"API {label} http={http} events={len(d.get('events') or [])}")
  else:
    print(f"API {label} http={http} err={d.get('error')} detail={str(d.get('detail',''))[:60]}")
except Exception as e:
  print(f"API {label} http={http} parse={e}")
PY
    rm -f "$tmp"
  done
fi
echo "=== LITE DONE ==="
