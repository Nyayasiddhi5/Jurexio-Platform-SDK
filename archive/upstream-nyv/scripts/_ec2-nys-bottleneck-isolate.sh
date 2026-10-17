#!/bin/sh
# Two of my conclusions are now suspect. Test both properly.
#
# (a) "Raising EMBED_CONCURRENCY 8->20 made throughput worse." Isolated Titan calls scale
#     nearly perfectly (conc=8 -> 1100ms wall, conc=24 -> 1162ms). So the earlier slowdown
#     was probably NOT Bedrock. Prime suspect: the per-row `UPDATE ... SET embedding` against
#     RDS, which at 20-wide contends on the SAME rows/pages the other 3 workers are writing.
#     Distinguish embed-only from embed+UPDATE.
# (b) "More Bedrock keys/credentials would help." Bedrock is IAM-authed and InvokeModel quota
#     is account+region+model scoped, so credentials should be irrelevant. Verify the identity
#     actually used, and confirm there is no per-credential ceiling being hit.
set -u
cd /opt/nyv/api || exit 3
echo "## (b) which identity does Bedrock use? (if a ROLE, extra API keys are irrelevant)"
TOK=`curl -sS -m 3 -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 60" 2>/dev/null`
ROLE=`curl -sS -m 3 -H "X-aws-ec2-metadata-token: $TOK" http://169.254.169.254/latest/meta-data/iam/security-credentials/ 2>/dev/null`
echo "   instance role: ${ROLE:-<none>}"
echo "   AWS_ACCESS_KEY_ID in envfile: `grep -cE '^AWS_ACCESS_KEY_ID=' /opt/nyv/api/.env`"
echo "   -> a role means SigV4 via rotating instance creds; adding static keys changes nothing"
echo ""
cat > /opt/nyv/api/_iso.mjs <<'JS' 
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { RDSClient, DescribeDBInstancesCommand } from "@aws-sdk/client-rds";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import pg from "pg";

const REGION = process.env.BEDROCK_REGION || "us-east-1";
const MODEL = process.env.BEDROCK_EMBED_MODEL || "amazon.titan-embed-text-v2:0";
const bedrock = new BedrockRuntimeClient({ region: REGION });
const T = "Criminal Petition No. 4471 of 2025, anticipatory bail under BNSS 482, cheque dishonour under s.138 NI Act 1881.";

console.log("## (b) identity note: see the shell section below (client-sts is not installed)");
const embed = async () => {
  const r = await bedrock.send(new InvokeModelCommand({
    modelId: MODEL, contentType: "application/json", accept: "application/json",
    body: JSON.stringify({ inputText: T, dimensions: 1024, normalize: true }),
  }));
  return JSON.parse(new TextDecoder().decode(r.body)).embedding;
};

console.log("\n## (a) EMBED-ONLY vs EMBED+UPDATE at 8 and 20 wide");
const d = await new RDSClient({ region: "ap-south-1" }).send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: "nyv-caselaw-pg" }));
const inst = d.DBInstances[0];
const sec = await new SecretsManagerClient({ region: "ap-south-1" }).send(new GetSecretValueCommand({ SecretId: inst.MasterUserSecret.SecretArn }));
const cr = JSON.parse(sec.SecretString);
const pool = new pg.Pool({ host: inst.Endpoint.Address, port: inst.Endpoint.Port, database: inst.DBName,
  user: cr.username, password: cr.password, ssl: { rejectUnauthorized: false }, max: 24,
  statement_timeout: 60000, keepAlive: true, keepAliveInitialDelayMillis: 10000 });

// Grab ALREADY-embedded ids and rewrite them: same write cost, zero data change.
const ids = (await pool.query(
  "SELECT id FROM judgments WHERE court_type='hc' AND embedding IS NOT NULL AND id > 16000000 ORDER BY id LIMIT 40"
)).rows.map((r) => r.id);
console.log(`   using ${ids.length} already-embedded ids (rewrite in place, no data change)`);

for (const n of [8, 20]) {
  // embed only
  let t0 = Date.now();
  await Promise.all(Array.from({ length: n }, () => embed()));
  const embMs = Date.now() - t0;
  // embed + per-row UPDATE, exactly as embed-corpus does
  t0 = Date.now();
  await Promise.all(Array.from({ length: n }, async (_, i) => {
    const e = await embed();
    await pool.query("UPDATE judgments SET embedding = $1::vector WHERE id = $2", [`[${e.join(",")}]`, ids[i % ids.length]]);
  }));
  const bothMs = Date.now() - t0;
  console.log(`   conc=${n}: embedOnly=${embMs}ms  embed+UPDATE=${bothMs}ms  updateOverhead=${bothMs - embMs}ms  perRow=${(bothMs / n).toFixed(0)}ms`);
}
await pool.end();
JS
node --env-file=/opt/nyv/api/.env _iso.mjs 2>&1 | grep -vE "NodeVersion|versions publ|will require|To continue|and security|More info|trace-warn|^$"
rm -f /opt/nyv/api/_iso.mjs
