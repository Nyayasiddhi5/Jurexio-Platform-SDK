#!/usr/bin/env bash
# Probe case_api worker paths for DuckDB / Python / scripts.
set -uo pipefail
echo "=== CASE_API WORKER ENV $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="

for p in \
  /home/ubuntu/scripts/case_api \
  /home/ubuntu/scripts/data_rds/rds_daily.sh \
  /home/ubuntu/scripts/case_api/rds_daily.sh \
  /home/ubuntu/scripts/case_api/build_full.sh \
  /home/ubuntu/scripts/case_api/_build/case_lookup_full \
  /opt/nyv/api/.env; do
  if [ -e "$p" ]; then
    echo "EXISTS $p"
    [ -f "$p" ] && head -3 "$p" 2>/dev/null | sed 's/=.*/=***/'
  else
    echo "MISSING $p"
  fi
done

echo "--- python duckdb ---"
for py in python3 /home/ubuntu/scripts/case_api/.venv/bin/python3 /home/ubuntu/scripts/case_api/venv/bin/python3 /opt/nyv/api/.venv/bin/python3; do
  if command -v "$py" >/dev/null 2>&1 || [ -x "$py" ]; then
    "$py" -c "import duckdb; print('OK', '$py', duckdb.__version__)" 2>/dev/null || echo "NO_DUCKDB $py"
  fi
done

echo "--- node hyparquet ---"
node -e "import('hyparquet').then(m=>console.log('hyparquet OK')).catch(e=>console.log('hyparquet ERR',e.message))" 2>/dev/null || \
  cd /opt/nyv/api 2>/dev/null && node -e "import('hyparquet').then(m=>console.log('hyparquet OK api')).catch(e=>console.log('ERR',e.message))"

echo "--- views ---"
cd /opt/nyv/api || exit 0
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
  database: "case_api_search", user: creds.username, password: creds.password,
  ssl: ssl(), max: 1, statement_timeout: 60000,
});
const views = await pool.query(`
  SELECT table_name, left(pg_get_viewdef(table_name::regclass, true), 200) AS def
  FROM information_schema.views WHERE table_schema='public'
`);
console.log("VIEWS", JSON.stringify(views.rows));
await pool.end();
NODE

echo "=== WORKER ENV DONE ==="
