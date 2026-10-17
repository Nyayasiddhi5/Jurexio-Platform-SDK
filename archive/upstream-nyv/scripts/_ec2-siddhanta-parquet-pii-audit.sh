#!/usr/bin/env bash
# NV-SIDDHANTA-PARQUET-PII-AUDIT-001 — trace PII columns Siddhanta → case_lookup vs cnr_case_details.
# Runs ON caselaw-worker. NV-SECRETS-001: key names and counts only.
set -uo pipefail
echo "=== SIDDHANTA PARQUET PII AUDIT $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="

PY="${CASE_API_PYTHON:-/home/ubuntu/scripts/case_api/.venv/bin/python3}"
LOOKUP="${CASE_API_LOOKUP_DIR:-/home/ubuntu/scripts/case_api/_build/case_lookup_full}"
EVENTS="${CASE_API_EVENTS_DIR:-/home/ubuntu/scripts/case_api/_build/case_events}"
echo "python=$PY lookup=$LOOKUP events=$EVENTS"

echo "--- S3 siddhanta spot (worker IAM) ---"
BUCKET="${SIDDHANTA_BUCKET:-siddhanta}"
for prefix in \
  "IND/00_RAW/high_courts/" \
  "IND/00_RAW/supreme_court/" \
  "IND/00_RAW/district_courts/vanga_mirror/"; do
  echo "S3_PREFIX $prefix"
  aws s3 ls "s3://${BUCKET}/${prefix}" --recursive 2>/dev/null | wc -l | awk '{print "S3_OBJ_COUNT", $1}'
done

echo "--- DuckDB case_lookup_full (50k sample) ---"
export CASE_API_LOOKUP_DIR="$LOOKUP"
bash "$(dirname "$0")/_ec2-case-api-p1-duckdb-pii-probe.sh" 2>/dev/null | grep -E '^DUCKDB_|^=== P1 DUCKDB' || true

echo "--- RDS cnr_case_details dimension (nyv_caselaw) ---"
cd /opt/nyv/api || exit 1
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
async function pool(db) {
  const rds = new RDSClient({ region: REGION });
  const inst = (await rds.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: "nyv-caselaw-pg" }))).DBInstances[0];
  const creds = JSON.parse((await new SecretsManagerClient({ region: REGION }).send(new GetSecretValueCommand({ SecretId: inst.MasterUserSecret.SecretArn }))).SecretString);
  return new pg.Pool({
    host: inst.Endpoint.Address, port: inst.Endpoint.Port ?? 5432,
    database: db, user: creds.username, password: creds.password,
    ssl: ssl(), max: 2, statement_timeout: 180000,
  });
}
async function q(pool, label, sql) {
  try {
    const r = await pool.query(sql);
    console.log(label, JSON.stringify(r.rows));
  } catch (e) {
    console.log(label, "ERR", String(e.message).slice(0, 160));
  }
}
const caselaw = await pool("nyv_caselaw");
await q(caselaw, "CNR_DETAILS_ROWCOUNT", "SELECT count(*)::bigint AS n, max(updated_at) AS max_updated FROM cnr_case_details");
await q(caselaw, "CNR_DETAILS_COLS", `
  SELECT column_name, data_type FROM information_schema.columns
  WHERE table_schema='public' AND table_name='cnr_case_details'
  ORDER BY ordinal_position
`);
await q(caselaw, "CNR_DETAILS_FILL", `
  SELECT
    count(*)::bigint AS total,
    count(*) FILTER (WHERE case_no IS NOT NULL AND btrim(case_no) <> '')::bigint AS case_no,
    count(*) FILTER (WHERE pet_advocate IS NOT NULL AND btrim(pet_advocate) <> '')::bigint AS pet_adv,
    count(*) FILTER (WHERE acts_sections IS NOT NULL AND acts_sections::text NOT IN ('[]','null'))::bigint AS acts,
    count(*) FILTER (WHERE raw IS NOT NULL)::bigint AS raw_present
  FROM cnr_case_details
`);
const piiKeyRe = /address|phone|email|father|mobile|aadhaar|pincode|party/i;
const sample = await caselaw.query(`
  SELECT cnr, jsonb_object_keys(raw) AS k
  FROM cnr_case_details
  WHERE raw IS NOT NULL
  LIMIT 5000
`);
const keys = new Set();
for (const row of sample.rows) {
  if (piiKeyRe.test(row.k)) keys.add(row.k);
}
console.log("CNR_RAW_PII_KEY_SAMPLE", JSON.stringify([...keys].sort().slice(0, 40)));
await caselaw.end();

const search = await pool("case_api_search");
await q(search, "STAGING_P1_FILL_2025PLUS", `
  SELECT
    count(*)::bigint AS slice_total,
    count(*) FILTER (WHERE diary_no IS NOT NULL AND btrim(diary_no) <> '')::bigint AS diary_nonempty,
    count(*) FILTER (
      (petitioner_address IS NOT NULL AND btrim(petitioner_address) <> '')
      OR (respondent_address IS NOT NULL AND btrim(respondent_address) <> '')
      OR (petitioner_phone IS NOT NULL AND btrim(petitioner_phone) <> '')
      OR (respondent_phone IS NOT NULL AND btrim(respondent_phone) <> '')
      OR (petitioner_email IS NOT NULL AND btrim(petitioner_email) <> '')
      OR (respondent_email IS NOT NULL AND btrim(respondent_email) <> '')
    )::bigint AS party_pii_any,
    count(*) FILTER (WHERE acts_json IS NOT NULL AND btrim(COALESCE(acts_json::text, '')) NOT IN ('','[]','null','{}'))::bigint AS acts_json
  FROM cases_search_staging
  WHERE extract(year FROM coalesce(decision_date, filing_date)) >= 2025
`);
await search.end();
NODE

echo "=== SIDDHANTA PARQUET PII AUDIT DONE ==="
