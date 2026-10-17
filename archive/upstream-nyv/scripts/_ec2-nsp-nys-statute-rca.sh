#!/usr/bin/env bash
# NYV nysdev: NYS federation + NSP statute compare RCA. Never echo secrets.
set -euo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
API="https://api.nyayasiddhi.online"
NYS="https://nyayasearch.nyayasiddhi.online"

echo "=== GATEWAY NYS FLAGS (presence only) ==="
docker exec nyv-gateway sh -c 'node -e "
const names=[
  \"NYV_F_NYS_KNOWLEDGE_PLANE\",\"NYS_KNOWLEDGE_BASE_URL\",\"NYS_KNOWLEDGE_TIMEOUT_MS\",
  \"NYV_STATUTE_QA_GROUNDING\",\"NYV_NSP_COUNSEL_QUEEN\",\"NYV_LLM_CASCADE_LEAD\"
];
for (const k of names) {
  const v=process.env[k];
  if (v==null || v===\"\") console.log(k+\"=UNSET\");
  else if (k.includes(\"URL\") || k.includes(\"LEAD\")) console.log(k+\"=\"+String(v).slice(0,80));
  else console.log(k+\"=SET len=\"+String(v).length);
}
const k=process.env.NYS_KNOWLEDGE_API_KEY||\"\";
console.log(\"NYS_KNOWLEDGE_API_KEY=\"+(k?(\"SET len=\"+k.length+\" prefix=\"+k.slice(0,4)):\"UNSET\"));
"'

echo "=== NYS HEALTH FROM GATEWAY ==="
docker exec nyv-gateway sh -c 'node -e "
const u=process.env.NYS_KNOWLEDGE_BASE_URL||\"https://nyayasearch.nyayasiddhi.online/api\";
fetch(u.replace(/\\/\$/,\"\")+\"/healthz\",{signal:AbortSignal.timeout(8000)})
  .then(async r=>{const t=await r.text(); console.log(\"healthz\", r.status, t.slice(0,120));})
  .catch(e=>console.log(\"healthz_err\", e.message));
"'

echo "=== NYS COMPARE VIA MACHINE KEY (from gateway) ==="
docker exec nyv-gateway sh -c 'node -e "
(async()=>{
  const base=(process.env.NYS_KNOWLEDGE_BASE_URL||\"https://nyayasearch.nyayasiddhi.online/api\").replace(/\\/\$/,\"\");
  const key=process.env.NYS_KNOWLEDGE_API_KEY||\"\";
  const h={Accept:\"application/json\"};
  if(key){h[\"X-API-Key\"]=key; h.Authorization=\"Bearer \"+key;}
  async function hit(path){
    const t0=Date.now();
    try{
      const r=await fetch(base+path,{headers:h,signal:AbortSignal.timeout(20000)});
      const t=await r.text();
      let d={}; try{d=JSON.parse(t)}catch{d={raw:t.slice(0,160)}}
      const found=d.found;
      const bns=(d.bnsMatches||d.newMatches||[]).length;
      const err=d.error||d.message||\"\";
      console.log(path, \"HTTP\", r.status, \"ms\", Date.now()-t0, \"found=\"+found, \"matches=\"+bns, \"err=\"+String(err).slice(0,80));
    }catch(e){console.log(path,\"EXC\",e.message)}
  }
  await hit(\"/statutes/compare/ipc-bns?section=302\");
  await hit(\"/statutes/compare/ipc-bns?section=420\");
  await hit(\"/statutes/compare/old-new?from=CrPC&section=438\");
  await hit(\"/statutes/compare/old-new?from=IEA&section=65B\");
  await hit(\"/statutes/compare/old-new?from=IRPC&section=438\");
  await hit(\"/statutes/search?q=IPC+302&limit=3\");
  await hit(\"/statutes/embedding/coverage\");
})();
"'

echo "=== NYV KNOWLEDGE PROXY VIA NSP SDK KEY ==="
NSPK=$(grep -E '^NYV_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')
for path in \
  "/api/jrx/knowledge/statutes/compare/ipc-bns?section=302" \
  "/api/jrx/knowledge/statutes/compare/old-new?from=CrPC&section=438" \
  "/api/jrx/knowledge/statutes/search?q=IPC%20302&limit=3"
do
  START=$(date +%s)
  code=$(curl -sS -o /tmp/jrx-k.json -w '%{http_code}' -m 25 -H "X-API-Key: ${NSPK}" "${API}${path}" || echo 000)
  ELAP=$(( $(date +%s) - START ))
  python3 - "$path" "$code" "$ELAP" <<'PY'
import json,sys
path,code,elap=sys.argv[1],sys.argv[2],sys.argv[3]
try: d=json.load(open("/tmp/jrx-k.json"))
except Exception: d={}
err=d.get("error") or d.get("message") or d.get("code") or ""
if isinstance(err,dict): err=err.get("message") or err.get("code")
found=d.get("found")
n=len(d.get("bnsMatches") or d.get("newMatches") or d.get("results") or [])
print("%s HTTP %s s=%s found=%s n=%s err=%s"%(path,code,elap,found,n,str(err)[:100]))
PY
done

echo "=== GATEWAY NYS CLIENT LOGS 3h ==="
docker logs nyv-gateway --since 3h 2>&1 | grep -E 'NYS knowledge|nys-knowledge|circuit OPEN|statutes/compare|AUTH_REQUIRED|knowledge plane' | tail -40 || true
