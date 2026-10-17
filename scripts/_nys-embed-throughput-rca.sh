#!/usr/bin/env bash
# Throughput snapshot + stall RCA (no secrets).
set -uo pipefail

log() { echo "=== $* ==="; }

log "STALL DETECTOR"
systemctl is-active nyv-embed-stall-detector.timer 2>/dev/null || true
tail -15 /opt/nyv/embed-stall.log 2>/dev/null || echo "no stall log"
journalctl -u nyv-embed-stall-detector.service --since '2 hours ago' --no-pager 2>/dev/null | tail -10

log "SHARD2 RESTARTS (why every 11min?)"
journalctl -u nyv-caselaw-embed-loop@2 --since '2 hours ago' --no-pager 2>/dev/null | grep -E 'Started|Stopped|STALL|stall|Killing' | tail -20

log "EMBED LOOP UNIT (template)"
systemctl cat nyv-caselaw-embed-loop@2.service 2>/dev/null | head -60

log "THROUGHPUT via node probe"
node --env-file=/opt/nyv/api/.env - <<'JS'
import { RDSClient, DescribeDBInstancesCommand } from "@aws-sdk/client-rds";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import pg from "pg";
const R = "ap-south-1";
const d = await new RDSClient({ region: R }).send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: "nyv-caselaw-pg" }));
const i = d.DBInstances?.[0];
const s = await new SecretsManagerClient({ region: R }).send(new GetSecretValueCommand({ SecretId: i.MasterUserSecret.SecretArn }));
const cr = JSON.parse(s.SecretString);
const c = new pg.Client({
  host: i.Endpoint.Address, port: i.Endpoint.Port ?? 5432, database: i.DBName ?? "nyv_caselaw",
  user: cr.username, password: cr.password, ssl: { rejectUnauthorized: false },
  statement_timeout: 120000, query_timeout: 120000,
});
await c.connect();
const r = await c.query(`
  SELECT scope, last_id, total_embedded, updated_at,
         EXTRACT(EPOCH FROM (now() - updated_at))::int AS stale_secs
    FROM embed_progress ORDER BY scope`);
console.log("--- embed_progress ---");
for (const row of r.rows) {
  console.log(`${row.scope}\tlast_id=${row.last_id}\tembedded=${row.total_embedded}\tstale=${row.stale_secs}s\tupdated=${row.updated_at}`);
}
const counts = await c.query(`
  SELECT court_type,
         count(*) FILTER (WHERE embedding IS NOT NULL)::bigint AS embedded,
         count(*)::bigint AS total
    FROM judgments WHERE court_type IN ('sc','hc','dc')
   GROUP BY court_type ORDER BY court_type`);
let te=0, tt=0;
console.log("--- counts ---");
for (const row of counts.rows) {
  const pct = row.total ? (row.embedded/row.total*100).toFixed(2) : '100';
  console.log(`${row.court_type}\t${row.embedded}/${row.total}\t${pct}%`);
  te += Number(row.embedded); tt += Number(row.total);
}
console.log(`TOTAL\t${te}/${tt}\t${(te/tt*100).toFixed(2)}%\tunembedded=${tt-te}`);
await c.end();
JS

log "MONITOR KEY NAMES (lengths only)"
grep -E '^(NYS_SDK_API_KEYS|NYS_KNOWLEDGE_API_KEY|MCP_TOKEN|NYV_SDK_KEY|AUTH_REQUIRED)=' /opt/nyv/api/.env 2>/dev/null | while IFS= read -r line; do
  k="${line%%=*}"; v="${line#*=}"; echo "$k len=${#v}"
done

log "COVERAGE with auth probe"
python3 - <<'PY'
import pathlib, subprocess, json
env = {}
for line in pathlib.Path("/opt/nyv/api/.env").read_text(errors="replace").splitlines():
    line=line.strip()
    if not line or line.startswith("#") or "=" not in line: continue
    k,v=line.split("=",1); env[k.strip()]=v.strip().strip("'\"")
key = ""
for k in ("NYS_SDK_API_KEYS","NYS_KNOWLEDGE_API_KEY","MCP_TOKEN","NYV_SDK_KEY"):
    if env.get(k):
        key = env[k].split(",")[0].strip(); break
print(f"key_found={bool(key)} key_len={len(key)} AUTH_REQUIRED={env.get('AUTH_REQUIRED','')}")
if key:
    r = subprocess.run(["curl","-sS","-m","30","-w","\nhttp=%{http_code}","-H",f"X-API-Key: {key}","-H",f"Authorization: Bearer {key}",
        "http://127.0.0.1:8080/api/caselaw/embedding/coverage"], capture_output=True, text=True)
    print(r.stdout[-500:])
else:
    print("no key — monitor will get http=0")
PY

log "EMBED LOG TAIL (actual throughput lines)"
for f in /opt/nyv/logs/embed.log /opt/nyv/api/logs/embed.log; do
  [ -f "$f" ] && echo "file=$f" && grep -E 'batch|embedded|rows|complete|57014|Throttl' "$f" 2>/dev/null | tail -25 && break
done
journalctl -u 'nyv-caselaw-embed-loop@*' --since '30 min ago' --no-pager 2>/dev/null | grep -iE 'batch|embedded|error|57014|throttl' | tail -15
