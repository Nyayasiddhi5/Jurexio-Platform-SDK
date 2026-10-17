#!/bin/sh
# Embed landscape on the REAL caselaw DB (nyv-caselaw-pg).
# My earlier probe failed because DATABASE_URL is a DIFFERENT database — the caselaw
# pool is built from DescribeDBInstances + the RDS managed master secret (rdsPool.ts).
# Replicated here with the app's own node_modules.
#
# PRIMARY QUESTION: the embed loop asserts "SC already ~complete at ~43.5k". If SC's
# TOTAL is ~43.5k then SC is DONE and an SC backfill would be wasted work — so measure
# SC total vs embedded before starting anything.
set -u
cd /opt/nyv/api || { echo "PROBE BROKEN: no app dir"; exit 3; }
cat > /opt/nyv/api/_land2.mjs <<'JS'
import { RDSClient, DescribeDBInstancesCommand } from "@aws-sdk/client-rds";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import pg from "pg";
const REGION = "ap-south-1", ID = "nyv-caselaw-pg";
const rds = new RDSClient({ region: REGION });
const d = await rds.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: ID }));
const inst = d.DBInstances?.[0];
if (!inst?.Endpoint?.Address) { console.log("PROBE BROKEN: no endpoint"); process.exit(3); }
const sm = new SecretsManagerClient({ region: REGION });
const s = await sm.send(new GetSecretValueCommand({ SecretId: inst.MasterUserSecret.SecretArn }));
const cr = JSON.parse(s.SecretString);
const c = new pg.Client({ host: inst.Endpoint.Address, port: inst.Endpoint.Port ?? 5432,
  database: inst.DBName ?? "nyv_caselaw", user: cr.username, password: cr.password,
  ssl: { rejectUnauthorized: false }, statement_timeout: 180000 });
await c.connect();
console.log("connected to:", inst.DBName, "on", inst.Endpoint.Address.split(".")[0]);

const q = async (label, sql) => {
  try { const r = await c.query(sql);
    console.log(`\n## ${label}`);
    r.rows.forEach(x => console.log("   " + Object.values(x).map(v => v === null ? "-" : v).join(" | ")));
    return r.rows;
  } catch (e) { console.log(`\n## ${label}\n   ERR ${String(e.message).slice(0,160)}`); return []; }
};

const ctl = await q("CONTROL (must print 5150)", "SELECT 5150 AS sentinel");
if (!ctl.length) { console.log("instrument failed"); process.exit(3); }

await q("*** THE KEY QUESTION: total vs embedded per court_type ***",
 `SELECT COALESCE(court_type,'(null)') AS court,
         to_char(count(*),'FM999,999,999') AS total,
         to_char(count(*) FILTER (WHERE embedding IS NOT NULL),'FM999,999,999') AS embedded,
         round(100.0*count(*) FILTER (WHERE embedding IS NOT NULL)/GREATEST(count(*),1),2)||'%' AS pct
  FROM judgments GROUP BY court_type ORDER BY count(*) DESC`);

await q("SC by year — newest 15 (is 2026 present at all?)",
 `SELECT year, to_char(count(*),'FM999,999') AS total,
         to_char(count(*) FILTER (WHERE embedding IS NULL),'FM999,999') AS todo
  FROM judgments WHERE court_type='sc' GROUP BY year ORDER BY year DESC NULLS LAST LIMIT 15`);

await q("HC by year — newest 15 (the 2026-backwards target)",
 `SELECT year, to_char(count(*),'FM999,999,999') AS total,
         to_char(count(*) FILTER (WHERE embedding IS NULL),'FM999,999,999') AS todo
  FROM judgments WHERE court_type='hc' GROUP BY year ORDER BY year DESC NULLS LAST LIMIT 15`);

await q("does id correlate with year? (if NOT, ORDER BY id is not chronological)",
 `SELECT year, min(id) AS min_id, max(id) AS max_id FROM judgments
  WHERE year IS NOT NULL GROUP BY year ORDER BY year DESC LIMIT 8`);

await q("rows with NULL year (cannot be ordered newest-first)",
 `SELECT to_char(count(*),'FM999,999,999') AS null_year,
         to_char(count(*) FILTER (WHERE embedding IS NULL),'FM999,999,999') AS unembedded
  FROM judgments WHERE year IS NULL`);

await q("embed_progress checkpoints", "SELECT scope, total_embedded, last_id, updated_at FROM embed_progress ORDER BY scope");

await q("indexes on judgments",
 `SELECT indexname||'  '||substr(indexdef, position('USING' in indexdef), 60) FROM pg_indexes WHERE tablename='judgments' ORDER BY 1`);

console.log("\n## PLAN: newest-first fetch (year DESC) — would it use an index?");
try { const r = await c.query(`EXPLAIN (ANALYZE,BUFFERS) SELECT id FROM judgments
  WHERE embedding IS NULL AND court_type='hc' AND year IS NOT NULL
  ORDER BY year DESC, id DESC LIMIT 150`);
  console.log(r.rows.map(x=>"   "+x["QUERY PLAN"]).slice(0,9).join("\n"));
} catch(e){ console.log("   ERR "+String(e.message).slice(0,160)); }
await c.end();
JS
node --env-file=/opt/nyv/api/.env _land2.mjs 2>&1 | head -95
rm -f /opt/nyv/api/_land2.mjs
echo ""
echo "## host capacity for multithreading"
echo "  vCPU=`nproc`  mem=`free -g | awk '/Mem:/{print $2}'`GB"
echo "  embed services: `systemctl list-units --type=service --no-pager 2>/dev/null | grep -c nyv-caselaw-embed`"
echo "  running embed procs: `pgrep -fc embed-corpus.mjs || echo 0`"
echo "  EMBED_* knobs currently set on the HC shard unit:"
systemctl show nyv-caselaw-embed-loop@0 -p Environment --no-pager 2>/dev/null | tr ' ' '\n' | grep -E '^EMBED|^BEDROCK' | head -12
