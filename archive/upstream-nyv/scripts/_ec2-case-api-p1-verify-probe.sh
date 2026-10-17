#!/usr/bin/env bash
# NV-CASE-API-P1-001 verify — schema + sample PII + nysapi resolve smoke.
set -uo pipefail
cd /opt/nyv/api || exit 1
echo "=== P1 VERIFY PROBE $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="

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
  try {
    const r = await pool.query(sql, params);
    console.log(label, JSON.stringify(r.rows));
  } catch (e) {
    console.log(label, "ERR", String(e.message).slice(0, 140));
  }
}
const rds = new RDSClient({ region: REGION });
const inst = (await rds.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: "nyv-caselaw-pg" }))).DBInstances[0];
const creds = JSON.parse((await new SecretsManagerClient({ region: REGION }).send(new GetSecretValueCommand({ SecretId: inst.MasterUserSecret.SecretArn }))).SecretString);
const pool = new pg.Pool({
  host: inst.Endpoint.Address, port: inst.Endpoint.Port ?? 5432,
  database: "case_api_search", user: creds.username, password: creds.password,
  ssl: ssl(), max: 2, statement_timeout: 120000,
});

await q(pool, "P1_COLS", `
  SELECT column_name FROM information_schema.columns
  WHERE table_schema='public' AND table_name='cases_search_staging'
    AND column_name IN ('diary_no','petitioner_address','respondent_address','petitioner_phone','acts_json')
  ORDER BY 1
`);

await q(pool, "P1_FILL_RATES", `
  SELECT
    count(*) FILTER (WHERE diary_no IS NOT NULL AND btrim(diary_no) <> '')::bigint AS diary_nonempty,
    count(*) FILTER (WHERE petitioner_address IS NOT NULL AND btrim(petitioner_address) <> '')::bigint AS pet_addr,
    count(*) FILTER (WHERE respondent_address IS NOT NULL AND btrim(respondent_address) <> '')::bigint AS res_addr,
    count(*) FILTER (WHERE petitioner_phone IS NOT NULL AND btrim(petitioner_phone) <> '')::bigint AS pet_phone,
    count(*) FILTER (WHERE acts_json IS NOT NULL AND btrim(acts_json::text) NOT IN ('','[]','null','{}'))::bigint AS acts_json
  FROM cases_search_staging
  WHERE extract(year FROM coalesce(decision_date, filing_date)) >= 2025
`);

for (const cnr of ["TSWL000000742024", "GJHC240256342024", "DLCT010000012024"]) {
  await q(pool, `SAMPLE_${cnr.slice(0,8)}`, `
    SELECT left(cnr,20) AS cnr, court_level,
      left(petitioner_address,40) AS pet_addr,
      left(respondent_address,40) AS res_addr,
      left(diary_no,20) AS diary_no,
      left(acts_json::text,60) AS acts_head
    FROM cases_search_staging WHERE cnr=$1 LIMIT 1
  `, [cnr]);
}

await pool.end();
NODE

pid=$(pgrep -f 'uvicorn.*8090' | head -1 || true)
KEY=""
[ -n "$pid" ] && [ -r "/proc/$pid/environ" ] && KEY=$(tr '\0' '\n' < "/proc/$pid/environ" | grep '^CASE_API_API_KEYS=' | head -1 | cut -d= -f2- | cut -d, -f1)
if [ "$(printf %s "$KEY" | wc -c)" -gt 8 ]; then
  for spec in "CNR|http://127.0.0.1:8090/v1/cases/TSWL000000742024" "DIARY|http://127.0.0.1:8090/v1/cases?court_type=SC&diary_no=17329%2F2025&page_size=1"; do
    label="${spec%%|*}"; url="${spec##*|}"
    http=$(curl -sS -o /tmp/p1v.json -w '%{http_code}' --max-time 30 -H "X-API-Key: $KEY" "$url" 2>/dev/null || echo ERR)
    python3 - "$label" "$http" /tmp/p1v.json <<'PY'
import json,sys
label,http,path=sys.argv[1:4]
try:
  d=json.load(open(path))
  c=d.get('case') or (d.get('cases') or [{}])[0]
  pii=[k for k in c.keys() if 'address' in k.lower() or 'phone' in k.lower() or k in ('diary_no','acts_sections','acts')]
  print(f"NYSAPI_{label} http={http} keys={pii[:8]} diary={c.get('diary_no')!r} acts={len(c.get('acts_sections') or c.get('acts') or [])}")
except Exception as e:
  print(f"NYSAPI_{label} http={http} err={e}")
PY
  done
fi
echo "=== P1 VERIFY DONE ==="
