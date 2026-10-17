#!/usr/bin/env bash
# NV-NYSAPI-RDS-SCHEMA-001 fast — avoids full-table GROUP BY on 26M rows.
set -uo pipefail
cd /opt/nyv/api || exit 1
echo "=== NV-NYSAPI-RDS-SCHEMA-FAST $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="

pid=$(pgrep -f 'uvicorn.*8090' | head -1 || true)
if [ -n "$pid" ] && [ -r "/proc/$pid/environ" ]; then
  tr '\0' '\n' < "/proc/$pid/environ" | grep -iE 'RDS|DB|TABLE|CASE|BACKEND' | sed 's/=.*/=***/' | head -20
fi

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
const pool = new pg.Pool({
  host: inst.Endpoint.Address, port: inst.Endpoint.Port ?? 5432,
  database: inst.DBName ?? "nyv_caselaw", user: creds.username, password: creds.password,
  ssl: ssl(), max: 2, statement_timeout: 180000,
});

async function q(label, sql, params = []) {
  const t0 = Date.now();
  try {
    const r = await pool.query(sql, params);
    console.log(label, "ms", Date.now() - t0, JSON.stringify(r.rows));
  } catch (e) {
    console.log(label, "ERR", String(e.message).slice(0, 140), "ms", Date.now() - t0);
  }
}

await q("TABLES", `
  SELECT table_name FROM information_schema.tables
  WHERE table_schema='public' AND table_type='BASE TABLE'
    AND (table_name ILIKE '%case%' OR table_name ILIKE '%cnr%' OR table_name ILIKE '%judgment%' OR table_name='ingest_progress')
  ORDER BY 1
`);

await q("TABLES_WITH_DIARY_CNR", `
  SELECT table_name, column_name FROM information_schema.columns
  WHERE table_schema='public' AND column_name IN ('diary_no','cnr','case_no','court_level','court_type')
  ORDER BY 1,2
`);

for (const ct of ["sc","hc","dc"]) {
  await q(`COUNTS_${ct.toUpperCase()}`, `
    SELECT count(*)::bigint AS total,
      count(*) FILTER (WHERE cnr IS NOT NULL AND btrim(cnr) <> '')::bigint AS with_cnr,
      count(*) FILTER (WHERE case_no ~ '^[0-9]+/[0-9]{4}$')::bigint AS diary_pattern
    FROM judgments WHERE court_type=$1
  `, [ct]);
}

for (const ct of ["sc","hc","dc"]) {
  await q(`MAX_${ct.toUpperCase()}`, `
    SELECT max(decision_date)::text AS max_decision, max(created_at)::text AS max_created, max(year)::int AS max_year
    FROM judgments WHERE court_type=$1
  `, [ct]);
}

for (const ct of ["sc","hc","dc"]) {
  await q(`LATEST3_${ct.toUpperCase()}`, `
    SELECT id, left(cnr,20) AS cnr, case_no, decision_date::text AS decision_date, left(title,50) AS title, source
    FROM judgments WHERE court_type=$1 ORDER BY decision_date DESC NULLS LAST, id DESC LIMIT 3
  `, [ct]);
}

await q("CNR_DETAILS", `
  SELECT count(*)::bigint AS total,
    max(updated_at)::text AS max_updated, max(synced_at)::text AS max_synced,
    max(filing_date)::text AS max_filing, max(decision_date)::text AS max_decision
  FROM cnr_case_details
`);

await q("SC_DIARY_STATS", `
  SELECT count(*)::bigint AS diary_rows,
    count(*) FILTER (WHERE cnr IS NULL OR btrim(cnr)='')::bigint AS no_cnr,
    count(*) FILTER (WHERE cnr IS NOT NULL AND btrim(cnr)<>'')::bigint AS with_cnr
  FROM judgments WHERE court_type='sc' AND case_no ~ '^[0-9]+/[0-9]{4}$'
`);

const DIARIES = ["17329/2025","50850/2026","45155/2024","44418/2026","40531/2026",
  "7319/2026","46024/2024","46771/2026","25293/2024","46569/2024"];
for (const d of DIARIES) {
  await q(`DIARY_J_${d.replace(/\//g,'_')}`, `
    SELECT id, left(cnr,20) AS cnr, case_no, left(title,40) AS title FROM judgments
    WHERE court_type='sc' AND case_no=$1 LIMIT 1
  `, [d]);
}

await pool.end();
NODE

# nysapi crosscheck
pid=$(pgrep -f 'uvicorn.*8090' | head -1 || true)
KEY=""
[ -n "$pid" ] && [ -r "/proc/$pid/environ" ] && KEY=$(tr '\0' '\n' < "/proc/$pid/environ" | grep '^CASE_API_API_KEYS=' | head -1 | cut -d= -f2- | cut -d, -f1)
echo "key_len=$(printf %s "$KEY" | wc -c | tr -d ' ')"
if [ "$(printf %s "$KEY" | wc -c)" -gt 8 ]; then
  for spec in "CNR_SC|ESCR010007972023" "CNR_HC|TSWL000000742024" "CNR_DC|DLCT010000012024"; do
    label="${spec%%|*}"; cnr="${spec##*|}"
    tmp=$(mktemp)
    ms=$(curl -sS -o "$tmp" -w '%{time_total}' --max-time 45 -H "X-API-Key: $KEY" "http://127.0.0.1:8090/v1/cases/$cnr" 2>/dev/null || echo ERR)
    python3 - "$label" "$ms" "$tmp" <<'PY'
import json,sys
label,ms,path=sys.argv[1:4]
try:
  c=(json.load(open(path)).get('case') or {})
  print(f"NYSAPI {label} ms={ms} cnr={c.get('cnr')!r} court={c.get('court_level')!r} case_number={str(c.get('case_number',''))[:40]!r} backend={(c.get('provenance') or {}).get('backend')!r}")
except Exception as e:
  print(f"NYSAPI {label} err={e}")
PY
    rm -f "$tmp"
  done
  for d in "17329/2025" "50850/2026" "25293/2024" "46569/2024"; do
    enc="${d//\//%2F}"; tmp=$(mktemp)
    ms=$(curl -sS -o "$tmp" -w '%{time_total}' --max-time 45 -H "X-API-Key: $KEY" \
      "http://127.0.0.1:8090/v1/cases?court_type=SC&diary_no=${enc}&page_size=1" 2>/dev/null || echo ERR)
    python3 - "$d" "$ms" "$tmp" <<'PY'
import json,sys
d,ms,path=sys.argv[1:4]
try:
  cs=json.load(open(path)).get('cases') or []
  if cs:
    c=cs[0]
    print(f"NYSAPI DIARY {d} ms={ms} found=1 cnr={c.get('cnr')!r} case_number={str(c.get('case_number',''))[:40]!r}")
  else:
    print(f"NYSAPI DIARY {d} ms={ms} found=0")
except Exception as e:
  print(f"NYSAPI DIARY {d} err={e}")
PY
    rm -f "$tmp"
  done
fi
echo "=== FAST DONE ==="
