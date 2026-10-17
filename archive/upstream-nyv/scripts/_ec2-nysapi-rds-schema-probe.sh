#!/usr/bin/env bash
# NV-NYSAPI-RDS-SCHEMA-001 — read-only nysapi RDS schema + CNR/diary freshness (SC/HC/DC).
# Runs ON caselaw-worker. NV-SECRETS-001: no secret values in output.
set -uo pipefail
cd /opt/nyv/api || exit 1

echo "=== NV-NYSAPI-RDS-SCHEMA-001 $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo "host=$(hostname -s 2>/dev/null || echo worker)"
echo "rds_instance=nyv-caselaw-pg"

# case-api env (names only)
pid=$(pgrep -f 'uvicorn.*8090' | head -1 || true)
if [ -n "$pid" ] && [ -r "/proc/$pid/environ" ]; then
  echo "=== CASE-API ENV (names only) ==="
  tr '\0' '\n' < "/proc/$pid/environ" | grep -iE 'RDS|DB|TABLE|DUCK|CASE|ATHENA|BACKEND' \
    | sed 's/=.*/=***REDACTED***/' || true
else
  echo "case_api_uvicorn=not_running"
fi

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

async function connectDb(dbName) {
  const rds = new RDSClient({ region: REGION });
  const desc = await rds.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: DB_ID }));
  const inst = desc.DBInstances?.[0];
  const sm = new SecretsManagerClient({ region: REGION });
  const secret = await sm.send(new GetSecretValueCommand({ SecretId: inst.MasterUserSecret.SecretArn }));
  const creds = JSON.parse(secret.SecretString ?? "{}");
  return new pg.Pool({
    host: inst.Endpoint.Address,
    port: inst.Endpoint.Port ?? 5432,
    database: dbName,
    user: creds.username,
    password: creds.password,
    ssl: ssl(),
    max: 2,
    statement_timeout: 120000,
  });
}

async function safeQuery(pool, label, sql, params = []) {
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

const dbName = process.env.CASELAW_DB_NAME ?? "nyv_caselaw";
console.log("CONNECT_DB", dbName);
const pool = await connectDb(dbName);

// 1) Table discovery — case/cnr/diary related
await safeQuery(pool, "TABLES_CASE_RELATED", `
  SELECT table_name,
    (SELECT count(*)::int FROM information_schema.columns c
     WHERE c.table_schema='public' AND c.table_name=t.table_name) AS col_count
  FROM information_schema.tables t
  WHERE table_schema='public'
    AND table_type='BASE TABLE'
    AND (
      table_name ILIKE '%case%'
      OR table_name ILIKE '%cnr%'
      OR table_name ILIKE '%diary%'
      OR table_name ILIKE '%judgment%'
      OR table_name IN ('ingest_progress','pdf_text_cache','cnr_resolve_metrics')
    )
  ORDER BY table_name
`);

// Column map for key tables
for (const tbl of ["judgments", "cnr_case_details"]) {
  await safeQuery(pool, `COLS_${tbl.toUpperCase()}`, `
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name=$1
      AND column_name IN (
        'cnr','diary_no','case_no','case_number','court_type','court_level','court_code',
        'decision_date','filing_date','updated_at','synced_at','created_at','ingested_at','source'
      )
    ORDER BY column_name
  `, [tbl]);
}

// Extra tables with diary_no or cnr columns
await safeQuery(pool, "TABLES_WITH_DIARY_OR_CNR_COL", `
  SELECT table_name, column_name, data_type
  FROM information_schema.columns
  WHERE table_schema='public'
    AND column_name IN ('diary_no','cnr','case_number','court_level','court_type')
  ORDER BY table_name, column_name
`);

// 2) judgments corpus stats per court
await safeQuery(pool, "JUDGMENTS_BY_COURT", `
  SELECT court_type,
    count(*)::bigint AS total,
    count(*) FILTER (WHERE cnr IS NOT NULL AND btrim(cnr) <> '')::bigint AS with_cnr,
    round(100.0 * count(*) FILTER (WHERE cnr IS NOT NULL AND btrim(cnr) <> '') / NULLIF(count(*),0), 2) AS cnr_pct,
    count(*) FILTER (WHERE case_no IS NOT NULL AND case_no ~ '^[0-9]+/[0-9]{4}$')::bigint AS diary_pattern,
    max(decision_date)::text AS max_decision_date,
    max(created_at)::text AS max_created_at,
    max(year)::int AS max_year
  FROM judgments
  WHERE court_type IN ('sc','hc','dc')
  GROUP BY court_type ORDER BY court_type
`);

// Latest 3 per court (judgments)
for (const ct of ["sc", "hc", "dc"]) {
  await safeQuery(pool, `JUDGMENTS_LATEST_${ct.toUpperCase()}`, `
    SELECT id, left(cnr, 20) AS cnr, case_no, court_type, court, year,
           decision_date::text AS decision_date, left(title, 60) AS title, source,
           created_at::text AS created_at
    FROM judgments
    WHERE court_type = $1
    ORDER BY decision_date DESC NULLS LAST, id DESC
    LIMIT 3
  `, [ct]);
}

// 3) cnr_case_details stats
await safeQuery(pool, "CNR_DETAILS_TOTAL", `
  SELECT count(*)::bigint AS total,
    count(*) FILTER (WHERE cnr IS NOT NULL AND btrim(cnr) <> '')::bigint AS with_cnr,
    max(updated_at)::text AS max_updated_at,
    max(synced_at)::text AS max_synced_at,
    max(filing_date)::text AS max_filing_date,
    max(decision_date)::text AS max_decision_date
  FROM cnr_case_details
`);

// cnr_case_details by court prefix (SC=ESCR, HC=4-letter, DC=varies)
await safeQuery(pool, "CNR_DETAILS_BY_PREFIX", `
  SELECT
    CASE
      WHEN left(cnr,4) = 'ESCR' OR court_code ILIKE '%supreme%' THEN 'sc'
      WHEN court_code IS NOT NULL AND length(court_code) <= 6 THEN 'hc'
      ELSE 'other'
    END AS court_bucket,
    count(*)::bigint AS n,
    max(filing_date)::text AS max_filing,
    max(decision_date)::text AS max_decision,
    max(updated_at)::text AS max_updated
  FROM cnr_case_details
  GROUP BY 1 ORDER BY n DESC
`);

// Diary in cnr_case_details raw JSON
await safeQuery(pool, "CNR_DETAILS_DIARY_COVERAGE", `
  SELECT count(*)::bigint AS total,
    count(*) FILTER (
      WHERE raw ? 'diary_number' OR raw ? 'diary_no' OR raw ? 'diaryNumber'
        OR case_no ~ '^[0-9]+/[0-9]{4}$'
    )::bigint AS diary_like
  FROM cnr_case_details
`);

// 4) SC diary index in judgments (case_no slash pattern for SC)
await safeQuery(pool, "SC_DIARY_INDEX_STATS", `
  SELECT
    count(*)::bigint AS total_sc,
    count(*) FILTER (WHERE case_no ~ '^[0-9]+/[0-9]{4}$')::bigint AS diary_rows,
    count(*) FILTER (WHERE case_no ~ '^[0-9]+/[0-9]{4}$' AND (cnr IS NULL OR btrim(cnr)=''))::bigint AS diary_no_cnr,
    count(*) FILTER (WHERE case_no ~ '^[0-9]+/[0-9]{4}$' AND cnr IS NOT NULL AND btrim(cnr)<>'')::bigint AS diary_with_cnr,
    max(updated_at)::text AS max_updated
  FROM (
    SELECT case_no, cnr, NULL::timestamptz AS updated_at FROM judgments WHERE court_type='sc'
  ) x
`);

// Latest SC diaries with/without case_number (non-diary case_no = formal case id)
await safeQuery(pool, "SC_DIARY_LATEST_SAMPLE", `
  SELECT case_no AS diary_no, left(cnr,20) AS cnr,
         left(case_no, 30) AS case_no_field,
         left(title, 50) AS title, year, decision_date::text AS decision_date, source
  FROM judgments
  WHERE court_type='sc' AND case_no ~ '^[0-9]+/[0-9]{4}$'
  ORDER BY year DESC, split_part(case_no,'/',1)::int DESC
  LIMIT 5
`);

// 5) User 10 SC diaries — RDS presence in judgments.case_no
const USER_DIARIES = [
  "17329/2025","50850/2026","45155/2024","44418/2026","40531/2026",
  "7319/2026","46024/2024","46771/2026","25293/2024","46569/2024"
];
for (const d of USER_DIARIES) {
  await safeQuery(pool, `USER_DIARY_RDS_${d.replace(/\//g,'_')}`, `
    SELECT id, left(cnr,20) AS cnr, case_no, court_type, left(title,40) AS title, source
    FROM judgments
    WHERE court_type='sc' AND case_no = $1
    LIMIT 1
  `, [d]);
  // Also check cnr_case_details.case_no
  await safeQuery(pool, `USER_DIARY_CNRDET_${d.replace(/\//g,'_')}`, `
    SELECT left(cnr,20) AS cnr, case_no, left(court_code,10) AS court_code, filing_date::text AS filing_date
    FROM cnr_case_details
    WHERE case_no = $1 OR raw->>'diary_number' = $1 OR raw->>'diary_no' = $1
    LIMIT 1
  `, [d]);
}

// ingest_progress freshness
await safeQuery(pool, "INGEST_PROGRESS_BY_PREFIX", `
  SELECT split_part(partition_key, '/', 1) AS prefix,
    count(*)::int AS partitions,
    sum(row_count)::bigint AS sum_rows,
    max(partition_key) AS latest_key
  FROM ingest_progress
  GROUP BY 1 ORDER BY prefix
`);

await pool.end();
NODE

echo "=== NYSAPI LIVE CROSSCHECK (local :8090 + public) ==="
pid=$(pgrep -f 'uvicorn.*8090' | head -1 || true)
CASE_KEY=""
if [ -n "$pid" ] && [ -r "/proc/$pid/environ" ]; then
  CASE_KEY=$(tr '\0' '\n' < "/proc/$pid/environ" | grep '^CASE_API_API_KEYS=' | head -1 | cut -d= -f2- | cut -d, -f1)
fi
echo "case_api_key_len=$(printf %s "${CASE_KEY:-}" | wc -c | tr -d ' ')"

probe_nysapi() {
  local label="$1" url="$2"
  [ "$(printf %s "$CASE_KEY" | wc -c)" -le 8 ] && { echo "SKIP $label no_key"; return; }
  local tmp; tmp=$(mktemp)
  local code ms
  ms=$(curl -sS -o "$tmp" -w '%{time_total}' --max-time 60 \
    -H "X-API-Key: $CASE_KEY" "$url" 2>/dev/null || echo ERR)
  code=$(head -c 1 "$tmp" >/dev/null 2>&1; python3 - "$tmp" <<'PY'
import json,sys
try:
  d=json.load(open(sys.argv[1]))
  if d.get('cases'):
    c=d['cases'][0]
    print(json.dumps({"http_shape":"search","returned":len(d['cases']),"cnr":c.get('cnr'),"diary_no":c.get('diary_no'),"case_number":c.get('case_number'),"court_level":c.get('court_level')}))
  elif d.get('case'):
    c=d['case']
    print(json.dumps({"http_shape":"single","cnr":c.get('cnr'),"diary_no":c.get('diary_no'),"case_number":c.get('case_number'),"court_level":c.get('court_level'),"backend":(c.get('provenance') or {}).get('backend')}))
  else:
    print(json.dumps({"error":d.get('error'),"detail":str(d.get('detail',''))[:80]}))
except Exception as e:
  print(json.dumps({"parse_err":str(e)[:60]}))
PY
  )
  echo "NYSAPI $label ms=$ms $code"
  rm -f "$tmp"
}

# Sample CNRs per court
probe_nysapi "CNR_SC" "http://127.0.0.1:8090/v1/cases/ESCR010007972023"
probe_nysapi "CNR_HC" "http://127.0.0.1:8090/v1/cases/TSWL000000742024"
probe_nysapi "CNR_DC" "http://127.0.0.1:8090/v1/cases/DLCT010000012024"

# User diaries (subset + all 10)
for d in "17329/2025" "50850/2026" "25293/2024" "46569/2024"; do
  enc="${d//\//%2F}"
  probe_nysapi "DIARY_${d//\//_}" "http://127.0.0.1:8090/v1/cases?court_type=SC&diary_no=${enc}&page_size=1"
done

echo "=== ALL 10 USER DIARIES NYSAPI ==="
for d in "17329/2025" "50850/2026" "45155/2024" "44418/2026" "40531/2026" \
         "7319/2026" "46024/2024" "46771/2026" "25293/2024" "46569/2024"; do
  enc="${d//\//%2F}"
  probe_nysapi "DIARY_${d//\//_}" "http://127.0.0.1:8090/v1/cases?court_type=SC&diary_no=${enc}&page_size=1"
done

echo "=== PROBE DONE ==="
