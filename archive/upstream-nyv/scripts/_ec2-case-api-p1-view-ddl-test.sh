#!/usr/bin/env bash
set -uo pipefail
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
const rds = new RDSClient({ region: REGION });
const inst = (await rds.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: "nyv-caselaw-pg" }))).DBInstances[0];
const creds = JSON.parse((await new SecretsManagerClient({ region: REGION }).send(new GetSecretValueCommand({ SecretId: inst.MasterUserSecret.SecretArn }))).SecretString);
const pool = new pg.Pool({
  host: inst.Endpoint.Address, port: inst.Endpoint.Port ?? 5432,
  database: "case_api_search", user: creds.username, password: creds.password,
  ssl: ssl(), max: 1, statement_timeout: 120000,
});
const cols = await pool.query(`
  SELECT column_name FROM information_schema.columns
  WHERE table_name='cases_search_staging' AND column_name LIKE '%diary%' OR column_name LIKE '%address%'
  ORDER BY 1
`);
console.log("NEW_COLS", JSON.stringify(cols.rows));

const viewSql = `CREATE OR REPLACE VIEW cases AS
 SELECT md5((court_level::text || '|'::text) || cnr::text) AS case_id,
    cnr, court_level, case_title, case_number, case_type,
    NULL::text AS case_type_full,
    md5((((((COALESCE(court_level, ''::character varying)::text || '|'::text) || COALESCE(court_code, ''::text)) || '|'::text) || COALESCE(court_establishment, ''::text)) || '|'::text) || COALESCE(court, ''::text)) AS establishment_id,
    petitioner, respondent, petitioner_advocate, respondent_advocate,
    filing_date, registration_date, first_hearing_date, next_hearing_date, decision_date,
    case_status, disposal_nature, current_judge, current_purpose,
    fir_no, fir_year, police_station, NULL::text AS police_district,
    citation, neutral_citation,
    diary_no, petitioner_address, respondent_address,
    petitioner_phone, respondent_phone, petitioner_email, respondent_email,
    petitioner_father_name, respondent_father_name, acts_json, extra,
    NULL::timestamp with time zone AS source_synced_at
   FROM cases_search_staging`;

try {
  await pool.query(viewSql);
  console.log("VIEW_OK");
} catch (e) {
  console.log("VIEW_ERR", String(e.message).slice(0, 400));
}
await pool.end();
NODE
