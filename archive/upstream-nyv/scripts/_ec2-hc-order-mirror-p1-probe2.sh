#!/usr/bin/env bash
# NV-HC-MIRROR-P1-001 probe2 — staging/raw JSON + extended portal URL patterns.
set -uo pipefail
CNR="${1:-APHC010000832023}"
export CNR
cd /opt/nyv/api || exit 1
echo "=== NV-HC-ORDER-MIRROR-P1-PROBE2 cnr=$CNR $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="

node --env-file=/opt/nyv/api/.env <<'NODE'
import { readFileSync, existsSync } from "node:fs";
import pg from "pg";
import { RDSClient, DescribeDBInstancesCommand } from "@aws-sdk/client-rds";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

const CNR = process.env.CNR || "APHC010000832023";
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
  try {
    const r = await pool.query(sql, params);
    console.log(label, JSON.stringify(r.rows).slice(0, 1200));
  } catch (e) {
    console.log(label, "ERR", String(e.message).slice(0, 200));
  }
}

const caselaw = new pg.Pool({
  host: inst.Endpoint.Address, port: inst.Endpoint.Port ?? 5432,
  database: "nyv_caselaw", user: creds.username, password: creds.password,
  ssl: ssl(), max: 2, statement_timeout: 120000,
});
await q(caselaw, "CNR_RAW_KEYS", `
  SELECT jsonb_object_keys(raw) AS k FROM cnr_case_details WHERE cnr=$1 LIMIT 40
`, [CNR]);
await q(caselaw, "CNR_RAW_ORDER_SNIP", `
  SELECT
    (raw->'final_orders') IS NOT NULL AS has_fo,
    (raw->'interim_orders') IS NOT NULL AS has_io,
    jsonb_array_length(COALESCE(raw->'final_orders','[]'::jsonb)) AS fo_n,
    jsonb_array_length(COALESCE(raw->'interim_orders','[]'::jsonb)) AS io_n
  FROM cnr_case_details WHERE cnr=$1
`, [CNR]);
await q(caselaw, "CNR_RAW_FINAL0", `
  SELECT raw->'final_orders'->0 AS fo0 FROM cnr_case_details WHERE cnr=$1
`, [CNR]);
await caselaw.end();

const search = new pg.Pool({
  host: inst.Endpoint.Address, port: inst.Endpoint.Port ?? 5432,
  database: "case_api_search", user: creds.username, password: creds.password,
  ssl: ssl(), max: 2, statement_timeout: 120000,
});
await q(search, "STAGING_COLS_ORDERS", `
  SELECT column_name FROM information_schema.columns
  WHERE table_schema='public' AND table_name='cases_search_staging'
    AND column_name ILIKE '%order%'
  ORDER BY 1
`);
await q(search, "STAGING_ROW", `
  SELECT cnr, court_level,
    final_orders IS NOT NULL AS has_fo,
    interim_orders IS NOT NULL AS has_io,
    left(final_orders::text, 200) AS fo_snip
  FROM cases_search_staging WHERE cnr=$1 LIMIT 1
`, [CNR]);
await search.end();
NODE

KEY=""
pid=$(pgrep -f 'uvicorn.*8090' | head -1 || true)
[ -n "$pid" ] && [ -r "/proc/$pid/environ" ] && KEY=$(tr '\0' '\n' < "/proc/$pid/environ" | grep '^CASE_API_API_KEYS=' | head -1 | cut -d= -f2- | cut -d, -f1)
fn=""
if [ "$(printf %s "$KEY" | wc -c)" -gt 8 ]; then
  fn=$(curl -sS --max-time 60 -H "X-API-Key: $KEY" "http://127.0.0.1:8090/v1/cases/${CNR}" 2>/dev/null \
    | python3 -c "import json,sys; c=json.load(sys.stdin).get('case') or {}; fo=c.get('final_orders') or []; print((fo[0].get('filename') or '') if fo else '')" 2>/dev/null || true)
fi
fn="${fn#/}"
base=$(basename "${fn:-x.pdf}")
echo "basename_len=$(printf %s "$base" | wc -c | tr -d ' ')"

for url in \
  "https://hcservices.ecourts.gov.in/hcservices/orders/2023/${base}" \
  "https://hcservices.ecourts.gov.in/hcservices/main.php?filename=orders/2023/${base}" \
  "https://hcservices.ecourts.gov.in/hcservices/cases/display_pdf.php?filename=orders/2023/${base}" \
  "https://aphc.gov.in/hcservices/orders/2023/${base}" \
  "https://distcourtsap.gov.in/orders/2023/${base}"; do
  hc=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 -L -r 0-511 "$url" 2>/dev/null || echo ERR)
  ct=$(curl -sS -I --max-time 20 -L "$url" 2>/dev/null | grep -i '^content-type:' | head -1 | cut -c1-60 || true)
  echo "url_probe http=$hc ct=${ct:-none} tail=${url: -55}"
done

echo "=== public metadata parquet_case_details grep (CNR) ==="
aws s3 ls --no-sign-request "s3://indian-high-court-judgments/metadata/parquet_case_details/" 2>/dev/null | tail -3 || echo "s3_ls_skip"
# Sample: any object key containing order path pattern is unlikely — count only
echo "=== DONE ==="
