#!/usr/bin/env bash
# NV-NYS-HANDOVER-RDS-CROSSCHECK-001 — handover doc vs live RDS + nysapi + NYV cnr/resolve.
# Runs ON caselaw-worker. NV-SECRETS-001: no secret values in output.
set -uo pipefail
cd /opt/nyv/api || exit 1

echo "=== NV-NYS-HANDOVER-RDS-CROSSCHECK-001 $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo "host=$(hostname -s 2>/dev/null || echo worker)"
echo "rds_instance=nyv-caselaw-pg"

# --- RDS: all databases + case_api_search staging stats ---
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

async function getCreds() {
  const rds = new RDSClient({ region: REGION });
  const inst = (await rds.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: DB_ID }))).DBInstances[0];
  const sm = new SecretsManagerClient({ region: REGION });
  const creds = JSON.parse((await sm.send(new GetSecretValueCommand({ SecretId: inst.MasterUserSecret.SecretArn }))).SecretString ?? "{}");
  return { inst, creds };
}

async function q(pool, label, sql, params = []) {
  const t0 = Date.now();
  try {
    const r = await pool.query(sql, params);
    console.log(label, "ms", Date.now() - t0, JSON.stringify(r.rows));
    return r.rows;
  } catch (e) {
    console.log(label, "ERR", String(e.message).slice(0, 180), "ms", Date.now() - t0);
    return null;
  }
}

const { inst, creds } = await getCreds();
const basePool = new pg.Pool({
  host: inst.Endpoint.Address, port: inst.Endpoint.Port ?? 5432,
  database: "postgres", user: creds.username, password: creds.password,
  ssl: ssl(), max: 2, statement_timeout: 120000,
});

await q(basePool, "DATABASES", `
  SELECT datname, pg_catalog.pg_get_userbyid(datdba) AS owner,
    pg_catalog.pg_encoding_to_char(encoding) AS encoding
  FROM pg_catalog.pg_database
  WHERE datistemplate = false AND datname NOT IN ('rdsadmin')
  ORDER BY datname
`);
await basePool.end();

for (const dbName of ["nyv_caselaw", "case_api_search", "nyvapp"]) {
  const pool = new pg.Pool({
    host: inst.Endpoint.Address, port: inst.Endpoint.Port ?? 5432,
    database: dbName, user: creds.username, password: creds.password,
    ssl: ssl(), max: 2, statement_timeout: 180000,
  });
  console.log("=== DB", dbName, "===");
  await q(pool, `${dbName}_TABLES`, `
    SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_type='BASE TABLE'
    ORDER BY table_name LIMIT 40
  `);

  if (dbName === "case_api_search") {
    await q(pool, "CASE_API_COLS", `
      SELECT table_name, column_name, data_type FROM information_schema.columns
      WHERE table_schema='public'
        AND column_name IN ('cnr','diary_no','case_number','court_level','filing_date','decision_date','petitioner','respondent','fir_no','act')
      ORDER BY table_name, column_name
    `);
    await q(pool, "RDS_LOAD_STATE", `SELECT table_version, applied_at::text AS applied_at FROM rds_load_state ORDER BY applied_at DESC LIMIT 3`);
    for (const cl of ["SC", "HC", "DC"]) {
      await q(pool, `STAGING_COUNT_${cl}`, `
        SELECT court_level, count(*)::bigint AS n
        FROM cases_search_staging WHERE court_level = $1 GROUP BY court_level
      `, [cl]);
    }
    await q(pool, "STAGING_TOTAL", `SELECT count(*)::bigint AS total FROM cases_search_staging`);
    for (const cl of ["HC", "DC"]) {
      await q(pool, `STAGING_LATEST_${cl}`, `
        SELECT left(cnr,20) AS cnr, left(case_number,40) AS case_number, court_level,
               filing_date::text AS filing_date, decision_date::text AS decision_date
        FROM cases_search_staging WHERE court_level = $1
        ORDER BY decision_date DESC NULLS LAST, filing_date DESC NULLS LAST
        LIMIT 2
      `, [cl]);
    }
    // diary_no column check
    const diaryCol = await pool.query(`
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND column_name='diary_no' LIMIT 1
    `);
    console.log("RDS_HAS_DIARY_NO_COLUMN", diaryCol.rowCount > 0);
  }

  if (dbName === "nyv_caselaw") {
    for (const ct of ["sc", "hc", "dc"]) {
      await q(pool, `JUDG_${ct.toUpperCase()}`, `
        SELECT count(*)::bigint AS total,
          count(*) FILTER (WHERE cnr IS NOT NULL AND btrim(cnr) <> '')::bigint AS with_cnr,
          count(*) FILTER (WHERE case_no ~ '^[0-9]+/[0-9]{4}$')::bigint AS diary_pattern
        FROM judgments WHERE court_type = $1
      `, [ct]);
    }
    await q(pool, "CNR_DETAILS", `
      SELECT count(*)::bigint AS total, max(updated_at)::text AS max_updated, max(synced_at)::text AS max_synced
      FROM cnr_case_details
    `);
    await q(pool, "CNR_DETAILS_DIARY_RAW", `
      SELECT count(*) FILTER (WHERE raw ? 'diary_number' OR raw ? 'diary_no' OR case_no ~ '^[0-9]+/[0-9]{4}$')::bigint AS diary_like
      FROM cnr_case_details
    `);
  }
  await pool.end();
}
NODE

# --- nysapi live crosscheck (local :8090) ---
pid=$(pgrep -f 'uvicorn.*8090' | head -1 || true)
KEY=""
[ -n "$pid" ] && [ -r "/proc/$pid/environ" ] && KEY=$(tr '\0' '\n' < "/proc/$pid/environ" | grep '^CASE_API_API_KEYS=' | head -1 | cut -d= -f2- | cut -d, -f1)
echo "case_api_key_len=$(printf %s "${KEY:-}" | wc -c | tr -d ' ')"

probe_nys() {
  local label="$1" url="$2" expect_http="${3:-200}"
  [ "$(printf %s "$KEY" | wc -c)" -le 8 ] && { echo "SKIP $label no_key"; return; }
  local tmp; tmp=$(mktemp)
  local http ms
  http=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time 60 -H "X-API-Key: $KEY" "$url" 2>/dev/null || echo ERR)
  ms=$(curl -sS -o /dev/null -w '%{time_total}' --max-time 60 -H "X-API-Key: $KEY" "$url" 2>/dev/null || echo 0)
  python3 - "$label" "$http" "$ms" "$tmp" <<'PY'
import json, sys
label, http, ms, path = sys.argv[1:5]
try:
  d = json.load(open(path))
  if d.get("cases") is not None:
    cs = d["cases"]
    c = cs[0] if cs else {}
    fields = sorted([k for k,v in c.items() if v is not None and v != "" and v != []])[:20]
    print(f"NYSAPI {label} http={http} ms={ms} shape=search returned={len(cs)} cnr={c.get('cnr')!r} diary_no={c.get('diary_no')!r} court={c.get('court_level')!r} case_number={str(c.get('case_number',''))[:35]!r} fields_nonempty={fields}")
  elif d.get("case"):
    c = d["case"]
    fields = sorted([k for k,v in c.items() if v is not None and v != "" and v != []])[:25]
    fa = c.get("field_availability") or {}
    print(f"NYSAPI {label} http={http} ms={ms} shape=single cnr={c.get('cnr')!r} diary_no={c.get('diary_no')!r} court={c.get('court_level')!r} backend={(c.get('provenance') or {}).get('backend')!r} hearings={len(c.get('hearings') or [])} field_avail_keys={list(fa.keys())[:8]} fields_nonempty={fields}")
  else:
    print(f"NYSAPI {label} http={http} ms={ms} err={d.get('error')} detail={str(d.get('detail',''))[:80]}")
except Exception as e:
  print(f"NYSAPI {label} http={http} ms={ms} parse_err={e}")
PY
  rm -f "$tmp"
}

echo "=== NYSAPI HEALTH ==="
curl -sS -m 10 http://127.0.0.1:8090/health 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); print('health', {k:d.get(k) for k in ['status','table_version','rds_enabled','rds_reachable','lookup_query_ok','table_stale']})" 2>/dev/null || echo health_fail

probe_nys "SC_DIARY" "http://127.0.0.1:8090/v1/cases?court_type=SC&diary_no=17329%2F2025&page_size=1"
probe_nys "HC_DIARY_REFUSE" "http://127.0.0.1:8090/v1/cases?court_type=HC&diary_no=17329%2F2025&page_size=1" "400"
probe_nys "DC_DIARY_REFUSE" "http://127.0.0.1:8090/v1/cases?court_type=DC&diary_no=17329%2F2025&page_size=1" "400"
probe_nys "CNR_HC_TSWL" "http://127.0.0.1:8090/v1/cases/TSWL000000742024"
probe_nys "CNR_HC_RJHC" "http://127.0.0.1:8090/v1/cases/RJHC010324382023"
probe_nys "CNR_HC_GJHC" "http://127.0.0.1:8090/v1/cases/GJHC240256342024"
probe_nys "CNR_DC_DLCT" "http://127.0.0.1:8090/v1/cases/DLCT010000012024"
probe_nys "B9_HC" "http://127.0.0.1:8090/v1/cases/DLCT010043082025?court_type=HC"
probe_nys "B9_DC" "http://127.0.0.1:8090/v1/cases/DLCT010043082025?court_type=DC"
probe_nys "TIMELINE_GJHC" "http://127.0.0.1:8090/v1/cases/GJHC240256342024/timeline"

echo "=== CROSSCHECK DONE ==="
