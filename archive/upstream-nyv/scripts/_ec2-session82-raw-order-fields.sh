#!/usr/bin/env bash
set -uo pipefail
CNR=APHC010000832023
cd /opt/nyv/api
node --env-file=/opt/nyv/api/.env <<'NODE'
import { readFileSync, existsSync } from "node:fs";
import pg from "pg";
import { RDSClient, DescribeDBInstancesCommand } from "@aws-sdk/client-rds";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
const CNR = "APHC010000832023";
const REGION = "ap-south-1";
function ssl() {
  const p = process.env.RDS_CA_BUNDLE;
  if (p && existsSync(p)) return { rejectUnauthorized: true, ca: readFileSync(p, "utf8") };
  return { rejectUnauthorized: false };
}
const rds = new RDSClient({ region: REGION });
const inst = (await rds.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: "nyv-caselaw-pg" }))).DBInstances[0];
const creds = JSON.parse((await new SecretsManagerClient({ region: REGION }).send(new GetSecretValueCommand({ SecretId: inst.MasterUserSecret.SecretArn }))).SecretString);
const pool = new pg.Pool({ host: inst.Endpoint.Address, port: inst.Endpoint.Port ?? 5432, database: "nyv_caselaw", user: creds.username, password: creds.password, ssl: ssl(), max: 2 });
const r = await pool.query(`SELECT raw->'mobile_depth'->'finalOrder'->0 AS fo, raw->'finalOrder'->0 AS fo2 FROM cnr_case_details WHERE cnr=$1`, [CNR]);
console.log("mobile_depth_final0", JSON.stringify(r.rows[0]?.fo || r.rows[0]?.fo2 || {}).slice(0,800));
const r2 = await pool.query(`SELECT left(extra::text,600) FROM cases_search_staging WHERE cnr=$1`, [CNR]).catch(()=>({rows:[]}));
console.log("staging_extra_snip", r2.rows[0]?.left || "no_staging");
await pool.end();
NODE
echo "=== list /opt/Nyayavigya/secrets key names ==="
grep -E '^[A-Z0-9_]+=' /opt/Nyayavigya/secrets/.env.production 2>/dev/null | cut -d= -f1 | grep -iE 'NIC|ECOURT|HC|COOKIE|SESSION|CAPTCHA|HCSERVICE|MOBILE|DEPTH|TIER' | sort -u || echo "no_nyayavigya_secrets_on_worker"
grep -E '^[A-Z0-9_]+=' /opt/nyv/api/.env 2>/dev/null | cut -d= -f1 | grep -iE 'NIC|ECOURT|HC|COOKIE|SESSION|CAPTCHA|HCSERVICE|MOBILE|DEPTH|TIER' | sort -u
echo DONE
