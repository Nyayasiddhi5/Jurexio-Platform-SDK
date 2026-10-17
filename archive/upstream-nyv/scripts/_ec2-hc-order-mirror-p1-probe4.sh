#!/usr/bin/env bash
# NV-HC-MIRROR-P1-001 probe4 — S3 CNR key search + main.php body scan + case_api discover.
set -uo pipefail
CNR="${1:-APHC010000832023}"
cd /opt/nyv/api || exit 1
echo "=== NV-HC-ORDER-MIRROR-P1-PROBE4 cnr=$CNR ==="

KEY=""
pid=$(pgrep -f 'uvicorn.*8090' | head -1 || true)
[ -n "$pid" ] && [ -r "/proc/$pid/environ" ] && KEY=$(tr '\0' '\n' < "/proc/$pid/environ" | grep '^CASE_API_API_KEYS=' | head -1 | cut -d= -f2- | cut -d, -f1)
fn=""
if [ "$(printf %s "$KEY" | wc -c)" -gt 8 ]; then
  fn=$(curl -sS --max-time 60 -H "X-API-Key: $KEY" "http://127.0.0.1:8090/v1/cases/${CNR}" 2>/dev/null \
    | python3 -c "import json,sys; c=json.load(sys.stdin).get('case') or {}; fo=c.get('final_orders') or []; print((fo[0].get('filename') or '') if fo else '')" 2>/dev/null || true)
fi
fn="${fn#/}"
rel="${fn:-none}"
tmp=$(mktemp)
curl -sS -o "$tmp" --max-time 45 -L "https://hcservices.ecourts.gov.in/hcservices/main.php?filename=${rel}" 2>/dev/null || true
python3 - "$tmp" <<'PY'
import sys
p = sys.argv[1]
data = open(p, 'rb').read()
print(f"main_php_bytes={len(data)} pdf_magic_at={data.find(b'%PDF')} html_doctype={data[:20]!r}")
PY
rm -f "$tmp"

for bucket in ns-indian-highcourt-judgements-2 ns-highcourt-data-bucket indian-high-court-judgments; do
  hits=$(aws s3api list-objects-v2 --bucket "$bucket" --prefix "data/pdf/" --max-keys 1000 2>/dev/null \
    | python3 -c "import json,sys,cnr=sys.argv[1]; d=json.load(sys.stdin); ks=[x['Key'] for x in d.get('Contents') or [] if cnr in x.get('Key','')]; print(len(ks)); [print('  key_tail',k[-70:]) for k in ks[:3]]" "$CNR" 2>/dev/null || echo "0")
  echo "bucket=$bucket prefix_scan_hits_first1k=$hits"
done

echo "=== find case_api / mobile depth ==="
find /opt /home -maxdepth 4 -type d -name 'case_api' 2>/dev/null | head -5
find /opt /home -maxdepth 5 -type f -name '*.py' 2>/dev/null | xargs grep -l 'display_pdf' 2>/dev/null | head -5 | while read -r f; do echo "py_display_pdf=${f}"; done

echo "=== staging row keys (case_api_search) ==="
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
const pool = new pg.Pool({
  host: inst.Endpoint.Address, port: inst.Endpoint.Port ?? 5432,
  database: "case_api_search", user: creds.username, password: creds.password,
  ssl: ssl(), max: 2, statement_timeout: 120000,
});
const cols = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='cases_search_staging' ORDER BY ordinal_position`);
console.log("staging_col_count", cols.rowCount);
const interesting = cols.rows.map(r => r.column_name).filter(c => /order|extra|raw|json|mobile|depth|document/i.test(c));
console.log("staging_interesting_cols", interesting);
const row = await pool.query(`SELECT * FROM cases_search_staging WHERE cnr=$1 LIMIT 1`, [CNR]);
if (row.rows[0]) {
  const keys = Object.keys(row.rows[0]).filter(k => /order|extra|document|mobile|depth|json|raw/i.test(k));
  const snip = {};
  for (const k of keys) {
    const v = row.rows[0][k];
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    snip[k] = s?.slice(0, 120);
  }
  console.log("staging_orderish_snip", JSON.stringify(snip));
}
await pool.end();
NODE

echo "=== DONE ==="
