#!/bin/sh
# Does adding Bedrock credentials help? Bedrock is IAM-authenticated and its InvokeModel
# quota is ACCOUNT + REGION + MODEL scoped, not per-credential — so more keys should do
# nothing. Test the claim rather than assert it, and get true PER-CALL latency for both
# providers, because I earlier compared Gemini's per-call time against Titan's *effective*
# per-row rate, which is not the same number and may have been unfair to Gemini.
set -u
cd /opt/nyv/api || exit 3
cat > /opt/nyv/api/_lat.mjs <<'JS'
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
const REGION = process.env.BEDROCK_REGION || "ap-south-1";
const MODEL = process.env.BEDROCK_EMBED_MODEL || "amazon.titan-embed-text-v2:0";
const TEXT = "In the High Court of Judicature at Hyderabad, Criminal Petition No. 4471 of 2025, "
  + "anticipatory bail under BNSS section 482 in a cheque dishonour matter under section 138 "
  + "of the Negotiable Instruments Act 1881.";

const bedrock = new BedrockRuntimeClient({ region: REGION });
const titanOnce = async () => {
  const t = Date.now();
  const r = await bedrock.send(new InvokeModelCommand({
    modelId: MODEL, contentType: "application/json", accept: "application/json",
    body: JSON.stringify({ inputText: TEXT, dimensions: 1024, normalize: true }),
  }));
  const body = JSON.parse(new TextDecoder().decode(r.body));
  return { ms: Date.now() - t, dims: body.embedding?.length };
};

const key = (process.env.GEMINI_API_KEYS || process.env.GOOGLE_API_KEY || "").split(/[,;\s]+/).filter(Boolean);
const geminiOnce = async (k) => {
  const t = Date.now();
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${process.env.NYV_GEMINI_EMBED_MODEL || "gemini-embedding-2"}:embedContent?key=${k}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: { parts: [{ text: TEXT }] }, outputDimensionality: 1024 }),
  });
  const j = await r.json();
  return { ms: Date.now() - t, dims: j?.embedding?.values?.length, status: r.status };
};

const stats = (xs) => {
  const s = xs.slice().sort((a, b) => a - b);
  return { p50: s[Math.floor(s.length / 2)], min: s[0], max: s[s.length - 1],
           mean: Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) };
};

console.log(`## region=${REGION} model=${MODEL}  geminiKeys=${key.length}`);

// 1) TRUE per-call latency, sequential. This is the apples-to-apples comparison.
console.log("\n## 1. per-call latency, SEQUENTIAL (x8 each)");
const tSeq = []; for (let i = 0; i < 8; i++) { try { tSeq.push((await titanOnce()).ms); } catch (e) { console.log("   titan err " + String(e.name)); } }
console.log(`   titan  : ${JSON.stringify(stats(tSeq))}  raw=${tSeq.join(",")}`);
if (key.length) {
  const gSeq = []; for (let i = 0; i < 8; i++) { const r = await geminiOnce(key[0]); if (r.dims) gSeq.push(r.ms); }
  console.log(`   gemini : ${JSON.stringify(stats(gSeq))}  raw=${gSeq.join(",")}`);
}

// 2) Does Bedrock shed load as LATENCY (not 429)? Compare 8-wide vs 24-wide.
console.log("\n## 2. Titan under concurrency — does latency rise instead of throttling?");
for (const n of [8, 24]) {
  const t0 = Date.now();
  const rs = await Promise.allSettled(Array.from({ length: n }, () => titanOnce()));
  const ok = rs.filter((r) => r.status === "fulfilled");
  const lat = ok.map((r) => r.value.ms);
  const errs = rs.filter((r) => r.status === "rejected").map((r) => String(r.reason?.name || r.reason).slice(0, 40));
  console.log(`   conc=${n}: wall=${Date.now() - t0}ms ok=${ok.length}/${n} perCall=${JSON.stringify(stats(lat))} throttles=${errs.filter((e) => /Throttl/i.test(e)).length}`);
  if (errs.length) console.log(`      errors: ${[...new Set(errs)].join(" | ")}`);
}

// 3) Do MULTIPLE Gemini keys add real parallel capacity? (different vendor => own quota)
if (key.length > 1) {
  console.log("\n## 3. Gemini with 1 key vs all keys in parallel (does the key list add capacity?)");
  for (const useKeys of [[key[0]], key]) {
    const per = 6, t0 = Date.now();
    const jobs = [];
    for (let i = 0; i < per * useKeys.length; i++) jobs.push(geminiOnce(useKeys[i % useKeys.length]));
    const rs = await Promise.allSettled(jobs);
    const ok = rs.filter((r) => r.status === "fulfilled" && r.value.dims);
    const n429 = rs.filter((r) => r.status === "fulfilled" && r.value.status === 429).length;
    console.log(`   keys=${useKeys.length} calls=${jobs.length}: wall=${Date.now() - t0}ms ok=${ok.length} http429=${n429} => ${(ok.length / ((Date.now() - t0) / 1000)).toFixed(1)} calls/s`);
  }
}
JS
node --env-file=/opt/nyv/api/.env _lat.mjs 2>&1 | grep -vE "NodeVersion|versions publ|will require|To continue|and security|More info|trace-warn|^$"
rm -f /opt/nyv/api/_lat.mjs
