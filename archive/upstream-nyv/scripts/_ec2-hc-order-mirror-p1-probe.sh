#!/usr/bin/env bash
# NV-HC-MIRROR-P1-001 — read-only: HC order PDF source discovery (caselaw-worker).
# NV-SECRETS-001: no secret values; HTTP codes and byte lengths only.
set -uo pipefail
CNR="${1:-APHC010000832023}"
cd /opt/nyv/api || exit 1
echo "=== NV-HC-ORDER-MIRROR-P1-PROBE cnr=$CNR $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="

KEY=""
pid=$(pgrep -f 'uvicorn.*8090' | head -1 || true)
[ -n "$pid" ] && [ -r "/proc/$pid/environ" ] && KEY=$(tr '\0' '\n' < "/proc/$pid/environ" | grep '^CASE_API_API_KEYS=' | head -1 | cut -d= -f2- | cut -d, -f1)
echo "case_api_key_len=$(printf %s "${KEY:-}" | wc -c | tr -d ' ')"

tmp=$(mktemp)
if [ "$(printf %s "$KEY" | wc -c)" -gt 8 ]; then
  code=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time 90 -H "X-API-Key: $KEY" \
    "http://127.0.0.1:8090/v1/cases/${CNR}" 2>/dev/null || echo ERR)
  echo "nysapi_case_http=$code"
  python3 - "$tmp" <<'PY'
import json, sys
path = sys.argv[1]
d = json.load(open(path))
c = d.get("case") or {}
fo = c.get("final_orders") or []
io = c.get("interim_orders") or []
print(f"final_orders_count={len(fo) if isinstance(fo, list) else 0}")
print(f"interim_orders_count={len(io) if isinstance(io, list) else 0}")
def sample(arr, label):
    if not isinstance(arr, list) or not arr:
        return
    for i, r in enumerate(arr[:3]):
        if isinstance(r, dict):
            fn = r.get("filename") or r.get("file_name") or ""
            print(f"{label}_{i}_order_id={r.get('order_id')!r} order_date={r.get('order_date')!r} filename_len={len(str(fn))} filename_tail={str(fn)[-48:]!r}")
sample(fo, "final")
sample(io, "interim")
PY
else
  echo "SKIP nysapi no_key"
fi
rm -f "$tmp"

export CNR
node --env-file=/opt/nyv/api/.env <<NODE
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
  database: "nyv_caselaw", user: creds.username, password: creds.password,
  ssl: ssl(), max: 2, statement_timeout: 120000,
});

const cols = await pool.query(`
  SELECT column_name FROM information_schema.columns
  WHERE table_schema='public' AND table_name='cnr_case_details'
    AND column_name IN ('final_orders','interim_orders','raw','extra')
  ORDER BY 1
`);
console.log("cnr_case_details_order_cols", cols.rows.map((r) => r.column_name));

const row = await pool.query(
  `SELECT cnr, left(case_no, 30) AS case_no,
          jsonb_typeof(final_orders) AS fo_type,
          jsonb_array_length(final_orders) AS fo_len,
          jsonb_typeof(interim_orders) AS io_type,
          jsonb_array_length(interim_orders) AS io_len
   FROM cnr_case_details WHERE cnr = $1 LIMIT 1`,
  [CNR],
);
console.log("cnr_case_details_row", JSON.stringify(row.rows[0] || null));

const foSample = await pool.query(
  `SELECT elem->>'filename' AS filename, elem->>'order_id' AS order_id, elem->>'order_date' AS order_date
   FROM cnr_case_details, jsonb_array_elements(final_orders) elem
   WHERE cnr = $1 LIMIT 2`,
  [CNR],
);
for (const r of foSample.rows) {
  const fn = r.filename || "";
  console.log("final_order_sample", { order_id: r.order_id, order_date: r.order_date, filename_len: fn.length, filename_tail: fn.slice(-56) });
}

const batch = await pool.query(`
  SELECT count(*)::bigint AS n
  FROM cnr_case_details
  WHERE final_orders IS NOT NULL AND jsonb_array_length(final_orders) > 0
`);
console.log("cnr_with_final_orders", batch.rows[0]?.n);

await pool.end();
NODE

echo "=== filesystem grep (basename from nysapi) ==="
# Best-effort: any PDF under /opt/nyv with CNR in name
find /opt/nyv -maxdepth 5 -type f -name "*${CNR}*.pdf" 2>/dev/null | head -5 | while read -r f; do
  sz=$(stat -c%s "$f" 2>/dev/null || stat -f%z "$f" 2>/dev/null || echo 0)
  echo "local_pdf path_tail=${f: -80} bytes=$sz"
done
cnt=$(find /opt/nyv -maxdepth 5 -type f -name "*${CNR}*.pdf" 2>/dev/null | wc -l | tr -d ' ')
echo "local_pdf_count=$cnt"

echo "=== portal fetch probe (first final order filename) ==="
# Pull filename from nysapi again for HTTP probe
if [ "$(printf %s "$KEY" | wc -c)" -gt 8 ]; then
  fn=$(curl -sS --max-time 60 -H "X-API-Key: $KEY" "http://127.0.0.1:8090/v1/cases/${CNR}" 2>/dev/null \
    | python3 -c "import json,sys; c=json.load(sys.stdin).get('case') or {}; fo=c.get('final_orders') or []; print((fo[0].get('filename') or '') if fo else '')" 2>/dev/null || true)
  fn="${fn#/}"
  echo "probe_filename_len=$(printf %s "$fn" | wc -c | tr -d ' ')"
  if [ -n "$fn" ]; then
    for base in \
      "https://hcservices.ecourts.gov.in/hcservices/${fn}" \
      "https://hcservices.ecourts.gov.in/${fn}" \
      "https://aphc.gov.in/${fn}"; do
      hc=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 25 -L -r 0-1023 "$base" 2>/dev/null || echo ERR)
      cl=$(curl -sS -o /dev/null -w '%{size_download}' --max-time 25 -L -r 0-1023 "$base" 2>/dev/null || echo 0)
      echo "HEAD_RANGE base_tail=${base: -60} http=$hc bytes=$cl"
    done
    # Owned bucket mirror key probe (no credentials in output)
    basefile=$(basename "$fn")
    for bucket in ns-indian-highcourt-judgements-2 ns-highcourt-data-bucket; do
      key="data/orders/cnr=${CNR}/${basefile}"
      hc=$(aws s3api head-object --bucket "$bucket" --key "$key" --query ContentLength --output text 2>/dev/null || echo MISSING)
      echo "s3_head bucket=$bucket key_tail=${key: -50} content_len=$hc"
    done
  fi
fi

echo "=== DONE ==="
