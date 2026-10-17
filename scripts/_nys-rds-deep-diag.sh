#!/usr/bin/env bash
# Deep RDS + caselaw diag on worker using node --env-file (no unbound var traps).
set -uo pipefail
cd /opt/nyv/api || exit 1

echo "=== EMBED ==="
for u in nyv-caselaw-embed-loop@{0,1,2} nyv-caselaw-embed-dc nyv-embed-statutes-loop; do
  echo "$u: $(systemctl is-active $u 2>/dev/null || echo inactive)"
done

echo "=== PG CLEANUP + COUNTS ==="
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
const desc = await rds.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: "nyv-caselaw-pg" }));
const inst = desc.DBInstances?.[0];
const sm = new SecretsManagerClient({ region: REGION });
const secret = await sm.send(new GetSecretValueCommand({ SecretId: inst.MasterUserSecret.SecretArn }));
const creds = JSON.parse(secret.SecretString ?? "{}");
const pool = new pg.Pool({
  host: inst.Endpoint.Address,
  port: inst.Endpoint.Port ?? 5432,
  database: inst.DBName ?? "nyv_caselaw",
  user: creds.username,
  password: creds.password,
  ssl: ssl(),
  max: 2,
  statement_timeout: 15000,
});
const bad = await pool.query(`SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND state = 'idle in transaction (aborted)'`);
let killed = 0;
for (const row of bad.rows) {
  await pool.query("SELECT pg_terminate_backend($1)", [row.pid]);
  killed += 1;
}
console.log("terminated_aborted_idle_tx", killed);
const act = await pool.query("SELECT state, count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() GROUP BY state ORDER BY n DESC");
console.log("pg_activity", JSON.stringify(act.rows));
try {
  const t0 = Date.now();
  const cnt = await pool.query("SELECT COUNT(*)::bigint AS n FROM judgments");
  console.log("judgments_count", cnt.rows[0]?.n, "ms", Date.now()-t0);
} catch (e) {
  console.log("judgments_count_err", String(e.message).slice(0,120));
}
try {
  const t0 = Date.now();
  const fts = await pool.query("SELECT COUNT(*)::bigint AS n FROM judgments WHERE search_vector @@ plainto_tsquery('english', 'bail') LIMIT 1");
  console.log("fts_bail_count", fts.rows[0]?.n, "ms", Date.now()-t0);
} catch (e) {
  console.log("fts_bail_err", String(e.message).slice(0,120));
}
await pool.end();
NODE

echo "=== API RESTART ==="
systemctl restart nyv-api
sleep 4
systemctl is-active nyv-api

echo "=== CURL PROBES ==="
KEY=$(grep -E '^NYS_SDK_API_KEYS=' /opt/nyv/api/.env | head -1 | cut -d= -f2- | cut -d, -f1)
for spec in "bail|fts" "Section+420+IPC|fts"; do
  q="${spec%%|*}"; mode="${spec##*|}"
  tmp=$(mktemp)
  code=$(curl -sS -m 30 -o "$tmp" -w '%{http_code}' -H "x-api-key: $KEY" \
    "http://127.0.0.1:8080/api/caselaw/search?q=${q}&limit=5&jurisdiction=IN&mode=${mode}" 2>/dev/null || echo ERR)
  python3 - "$q" "$mode" "$code" "$tmp" <<'PY'
import json, sys
q, mode, code, path = sys.argv[1:5]
try:
    d = json.load(open(path))
    print(f"curl q={q} mode={mode} http={code} total={d.get('total')} degraded={d.get('degraded')} reason={str(d.get('degradedReason','-'))[:60]}")
except Exception as e:
    print(f"curl q={q} mode={mode} http={code} err={e}")
PY
  rm -f "$tmp"
done

echo "=== API LOG (last degraded) ==="
journalctl -u nyv-api -n 15 --no-pager 2>/dev/null | grep -iE 'degraded|timeout|error|420|bail' | tail -8 || echo no_log

echo "=== DONE ==="
