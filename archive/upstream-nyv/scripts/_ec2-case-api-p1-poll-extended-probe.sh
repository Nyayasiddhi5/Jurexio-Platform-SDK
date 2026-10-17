#!/usr/bin/env bash
# P1 status poll extended — row counts, PII fill, P2 reverse-dc, CNR partyDetails presence.
set -uo pipefail
echo "=== P1 POLL EXTENDED $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="

echo "--- P2 reverse-dc ---"
pgrep -af "reverse|delta-dc|ingest-rds" || echo "no P2/P3 ingest process"
ls -lt /var/log/nys-ops/reverse-dc-*.log 2>/dev/null | head -2
P2LOG=$(ls -t /var/log/nys-ops/reverse-dc-*.log 2>/dev/null | head -1)
if [ -n "$P2LOG" ]; then
  echo "--- tail $P2LOG ---"
  tail -15 "$P2LOG"
fi

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
async function q(pool, label, sql, params = []) {
  try {
    const r = await pool.query(sql, params);
    console.log(label, JSON.stringify(r.rows));
  } catch (e) {
    console.log(label, "ERR", String(e.message).slice(0, 160));
  }
}
const rds = new RDSClient({ region: REGION });
const inst = (await rds.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: "nyv-caselaw-pg" }))).DBInstances[0];
const creds = JSON.parse((await new SecretsManagerClient({ region: REGION }).send(new GetSecretValueCommand({ SecretId: inst.MasterUserSecret.SecretArn }))).SecretString);
const pool = new pg.Pool({
  host: inst.Endpoint.Address, port: inst.Endpoint.Port ?? 5432,
  database: "case_api_search", user: creds.username, password: creds.password,
  ssl: ssl(), max: 2, statement_timeout: 180000,
});

await q(pool, "TOTAL_EST", `SELECT reltuples::bigint AS est FROM pg_class WHERE relname='cases_search_staging'`);

await q(pool, "Y2025_2026", `
  SELECT count(*)::bigint AS total,
    count(*) FILTER (WHERE extract(year FROM coalesce(decision_date, filing_date)) = 2026)::bigint AS y2026,
    count(*) FILTER (WHERE extract(year FROM coalesce(decision_date, filing_date)) = 2025)::bigint AS y2025
  FROM cases_search_staging
  WHERE extract(year FROM coalesce(decision_date, filing_date)) >= 2025
`);

await q(pool, "FILL_ALL", `
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

await pool.end();
NODE

pid=$(pgrep -f 'uvicorn.*8090' | head -1 || true)
KEY=""
[ -n "$pid" ] && [ -r "/proc/$pid/environ" ] && KEY=$(tr '\0' '\n' < "/proc/$pid/environ" | grep '^CASE_API_API_KEYS=' | head -1 | cut -d= -f2- | cut -d, -f1)
if [ "$(printf %s "$KEY" | wc -c)" -gt 8 ]; then
  http=$(curl -sS -o /tmp/p1c.json -w '%{http_code}' --max-time 30 -H "X-API-Key: $KEY" "http://127.0.0.1:8090/v1/cases/TSWL000000742024" 2>/dev/null || echo ERR)
  python3 - "$http" /tmp/p1c.json <<'PY'
import json, sys
http, path = sys.argv[1:3]
try:
  d = json.load(open(path))
  c = d.get("case") or {}
  parties = c.get("partyDetails") or c.get("parties") or []
  if not isinstance(parties, list):
    parties = []
  addr = phone = email = 0
  for p in parties:
    if not isinstance(p, dict):
      continue
    if p.get("address") or p.get("petitioner_address") or p.get("respondent_address"):
      addr += 1
    if p.get("phone") or p.get("petitioner_phone") or p.get("respondent_phone"):
      phone += 1
    if p.get("email") or p.get("petitioner_email") or p.get("respondent_email"):
      email += 1
  print(f"CNR_PARTY_FIELDS http={http} party_count={len(parties)} addr_nonempty={addr} phone_nonempty={phone} email_nonempty={email}")
except Exception as e:
  print(f"CNR_PARTY_FIELDS http={http} err={e}")
PY
fi
echo "=== P1 POLL EXTENDED DONE ==="
