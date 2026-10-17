#!/bin/sh
# NYS embed: the remaining unknowns, with a timeout long enough to actually answer.
# Settled already: SC todo=0 for every year (SC IS complete — my P0-6 was wrong);
# 0 rows with NULL year; index judgments_court_year_idx (court_type, year) exists.
# Open: HC/DC remaining by year, whether id correlates with year, and whether HC shard 2
# has stalled (its checkpoint is 2 days old while shards 0/1 updated minutes ago).
set -u
cd /opt/nyv/api || { echo "PROBE BROKEN: no app dir"; exit 3; }
cat > /opt/nyv/api/_gap.mjs <<'JS'
import { RDSClient, DescribeDBInstancesCommand } from "@aws-sdk/client-rds";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import pg from "pg";
const R="ap-south-1", ID="nyv-caselaw-pg";
const d=await new RDSClient({region:R}).send(new DescribeDBInstancesCommand({DBInstanceIdentifier:ID}));
const i=d.DBInstances?.[0];
const s=await new SecretsManagerClient({region:R}).send(new GetSecretValueCommand({SecretId:i.MasterUserSecret.SecretArn}));
const cr=JSON.parse(s.SecretString);
const c=new pg.Client({host:i.Endpoint.Address,port:i.Endpoint.Port??5432,database:i.DBName??"nyv_caselaw",
  user:cr.username,password:cr.password,ssl:{rejectUnauthorized:false},statement_timeout:900000});
await c.connect();
const q=async(l,sql)=>{const t=Date.now();try{const r=await c.query(sql);
  console.log(`\n## ${l}  (${((Date.now()-t)/1000).toFixed(1)}s)`);
  r.rows.forEach(x=>console.log("   "+Object.values(x).map(v=>v===null?"-":v).join(" | ")));
}catch(e){console.log(`\n## ${l}\n   ERR ${String(e.message).slice(0,120)}`);}};

if(!(await c.query("SELECT 5150 AS s")).rows.length){console.log("PROBE BROKEN");process.exit(3);}
console.log("## CONTROL 5150 ok");

await q("per court_type: total + unembedded (uses court_type,year index)",
 `SELECT court_type,
         to_char(count(*),'FM999,999,999') AS total,
         to_char(count(*) FILTER (WHERE embedding IS NULL),'FM999,999,999') AS todo
  FROM judgments GROUP BY court_type ORDER BY 1`);

await q("HC remaining by year — newest 12 (the 2026-backwards target)",
 `SELECT year, to_char(count(*),'FM999,999,999') AS total,
         to_char(count(*) FILTER (WHERE embedding IS NULL),'FM999,999,999') AS todo
  FROM judgments WHERE court_type='hc' GROUP BY year ORDER BY year DESC LIMIT 12`);

await q("DC remaining by year — newest 12",
 `SELECT year, to_char(count(*),'FM999,999,999') AS total,
         to_char(count(*) FILTER (WHERE embedding IS NULL),'FM999,999,999') AS todo
  FROM judgments WHERE court_type='dc' GROUP BY year ORDER BY year DESC LIMIT 12`);

await q("*** does id correlate with year? if NOT, ORDER BY id is not chronological ***",
 `SELECT year, min(id) AS min_id, max(id) AS max_id
  FROM judgments WHERE court_type='hc' GROUP BY year ORDER BY year DESC LIMIT 10`);

await q("newest-first plan (year DESC) — does it use judgments_court_year_idx?",
 `EXPLAIN SELECT id FROM judgments
   WHERE embedding IS NULL AND court_type='hc' ORDER BY year DESC, id DESC LIMIT 150`);
await c.end();
JS
node --env-file=/opt/nyv/api/.env _gap.mjs 2>&1 | grep -v NodeVersionSupport | head -70
rm -f /opt/nyv/api/_gap.mjs

echo ""
echo "## is HC shard 2 stalled? (checkpoint 2 days old vs shards 0/1 minutes old)"
for u in nyv-caselaw-embed-loop@0 nyv-caselaw-embed-loop@1 nyv-caselaw-embed-loop@2 nyv-caselaw-embed-dc; do
  printf '  %-32s %s  since=%s\n' "$u" \
    "`systemctl is-active $u 2>/dev/null`" \
    "`systemctl show $u -p ActiveEnterTimestamp --value 2>/dev/null | cut -c1-20`"
done
echo "  running embed-corpus procs + their scope args:"
ps -eo args | grep 'embed-corpus.mjs' | grep -v grep | sed 's/^/    /'
echo ""
echo "## throughput + throttling (last 200 embed log lines)"
tail -200 /opt/nyv/embed.log 2>/dev/null | grep -ciE "throttl|ThrottlingException" | sed 's/^/  throttle hits: /'
tail -6 /opt/nyv/embed.log 2>/dev/null | cut -c1-190 | sed 's/^/  /'
