#!/usr/bin/env bash
set -euo pipefail
echo "PC1_ECHO=5150"
API_DIR=/opt/nyv/api
ENV_FILE="$API_DIR/.env"
cd "$API_DIR"

ensure_env() {
  local key="$1" val="$2"
  if grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"
  else
    echo "${key}=${val}" >> "$ENV_FILE"
  fi
}

ensure_env ATHENA_TABLE_SC_CASE_DETAILS judgments_meta_sc_case_details
ensure_env ATHENA_TABLE_DC_CASE_DETAILS judgments_meta_dc_case_details
grep -E '^ATHENA_TABLE_(SC|DC)_CASE_DETAILS=' "$ENV_FILE"

echo "=== SC CTAS ==="
node athena-sc-case-details-ctas.mjs
echo "=== DC CTAS ==="
node athena-dc-case-details-ctas.mjs

echo "=== Glue verify (instance role) ==="
for t in judgments_meta_sc_case_details judgments_meta_dc_case_details; do
  aws glue get-table --database-name nyv_docs --name "$t" --region ap-south-1 --query 'Table.[Name,StorageDescriptor.Location]' --output text
done

echo "=== Athena row counts ==="
node <<'NODE'
const { AthenaClient, StartQueryExecutionCommand, GetQueryExecutionCommand, GetQueryResultsCommand } = require('@aws-sdk/client-athena');
const c = new AthenaClient({ region: 'ap-south-1' });
const DB = 'nyv_docs', OUT = 's3://usa-caselaw/athena/results/', WG = 'nyv-docs';
async function run(sql) {
  const s = await c.send(new StartQueryExecutionCommand({
    QueryString: sql, QueryExecutionContext: { Database: DB },
    ResultConfiguration: { OutputLocation: OUT }, WorkGroup: WG }));
  const id = s.QueryExecutionId;
  for (let i = 0; i < 90; i++) {
    const e = await c.send(new GetQueryExecutionCommand({ QueryExecutionId: id }));
    const st = e.QueryExecution.Status.State;
    if (st === 'SUCCEEDED') {
      const r = await c.send(new GetQueryResultsCommand({ QueryExecutionId: id, MaxResults: 5 }));
      const row = (r.ResultSet.Rows || [])[1];
      const val = row?.Data?.[0]?.VarCharValue ?? '?';
      return { ok: true, val, scanned: e.QueryExecution.Statistics.DataScannedInBytes };
    }
    if (st === 'FAILED' || st === 'CANCELLED') return { ok: false, err: e.QueryExecution.Status.StateChangeReason };
    await new Promise(r => setTimeout(r, 2000));
  }
  return { ok: false, err: 'timeout' };
}
(async () => {
  for (const t of ['judgments_meta_sc_case_details', 'judgments_meta_dc_case_details']) {
    const r = await run(`SELECT count(*) AS n FROM ${t}`);
    console.log(t, r.ok ? `count=${r.val} scanned=${r.scanned}` : `ERR=${r.err}`);
  }
  const cnrSc = await run("SELECT cnr FROM judgments_meta_sc_case_details WHERE cnr IS NOT NULL AND trim(cnr) <> '' LIMIT 1");
  console.log('sample_sc_cnr', cnrSc.ok ? cnrSc.val : cnrSc.err);
  const cnrDc = await run("SELECT cnr FROM judgments_meta_dc_case_details WHERE cnr IS NOT NULL AND trim(cnr) <> '' LIMIT 1");
  console.log('sample_dc_cnr', cnrDc.ok ? cnrDc.val : cnrDc.err);
})().catch(e => { console.error('COUNT_ERR', e.message); process.exit(1); });
NODE

if systemctl is-active --quiet nyv-api; then
  systemctl restart nyv-api
  sleep 3
  curl -sf -m 10 http://127.0.0.1:8080/healthz >/dev/null && echo "nyv-api healthz=OK" || echo "nyv-api healthz=FAIL"
fi

echo "CTAS_RUN_DONE=5150"
