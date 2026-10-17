#!/usr/bin/env bash
# Parent-agent probe bundle — no secret values in output
set -uo pipefail

echo "=== HOST ==="
hostname
date -u +%Y-%m-%dT%H:%M:%SZ

if [ -f /opt/nyv/api/.env ]; then
  echo "=== NYS WORKER ==="
  systemctl is-active jrx-api 2>/dev/null || echo "jrx-api inactive"
  curl -sf -m 10 http://127.0.0.1:8080/healthz | python3 -c "import sys,json; d=json.load(sys.stdin); print('healthz', d.get('status'), 'uptime', d.get('uptime'))" 2>/dev/null || echo "healthz FAIL"

  echo "--- worker jobs ---"
  pgrep -af 'backfill-sc-body-fts|nys-treatment-graph' || echo "no background pids"

  echo "--- sc-body-fts log tail ---"
  tail -3 /opt/nyv/logs/sc-body-fts.log 2>/dev/null || echo "(empty)"
  echo "--- extract log tail ---"
  tail -3 /opt/nyv/logs/treatment-graph-extract.log 2>/dev/null || echo "(empty)"
  echo "--- edges log tail ---"
  tail -3 /opt/nyv/logs/treatment-graph-edges.log 2>/dev/null || echo "(empty)"

  echo "--- FTS DDL stats ---"
  node /opt/nyv/api/apply-sc-body-fts-ddl.mjs 2>/dev/null | tail -1 || echo "ddl probe fail"

  echo "--- caselaw search probe ---"
  set -a && source /opt/nyv/api/.env && set +a
  KEY="${JRX_ECOSYSTEM_KNOWLEDGE_API_KEY:-${JRX_ECOSYSTEM_SDK_API_KEYS:-}}"; KEY="${KEY%%,*}"
  code=$(curl -sS -m 45 -o /tmp/cs.json -w '%{http_code}' -H "x-api-key: $KEY" \
    "http://127.0.0.1:8080/api/caselaw/search?q=bail&limit=2&jurisdiction=IN&courtType=sc" || echo 000)
  python3 - <<PY
import json
try:
  d=json.load(open("/tmp/cs.json"))
  n=len(d.get("results") or d.get("data",{}).get("results") or [])
  err=d.get("error") or d.get("message")
  print("caselaw_search http=$code results=%s err=%s" % ("$code", n, err))
except Exception as e:
  print("caselaw_search http=$code parse_err=%s" % e)
PY

  echo "--- CNR caseCreate (NYS direct) ---"
  curl -sf -m 90 -X POST -H 'Content-Type: application/json' -H "X-API-Key: ${KEY}" \
    -d '{"cnr":"RJHC010324382023","options":{"profile":"caseCreate","includeDocuments":false}}' \
    http://127.0.0.1:8080/api/cnr/resolve > /tmp/cnr-cc.json || echo "cnr curl fail"
  python3 - <<'PY'
import json
try:
  d=json.load(open("/tmp/cnr-cc.json"))
  data=d.get("data") or {}
  cc=data.get("caseCreate")
  print("cnr success=%s status=%s source=%s caseCreate=%s" % (
    d.get("success"), data.get("status"), data.get("source"), "yes" if cc else "no"))
  if cc:
    print("timeline_len=%s title=%s manifest_complete=%s" % (
      len(cc.get("timeline") or []),
      (cc.get("header") or {}).get("caseTitle",{}).get("value","")[:60],
      (cc.get("fieldManifest") or {}).get("complete")))
  print("sourcesTried=%s" % data.get("sourcesTried"))
except Exception as e:
  print("cnr parse err", e)
PY

  echo "--- citation graph row count ---"
  node -e "
const pg=require('pg');
(async()=>{
  const p=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
  try{
    const r=await p.query(\"SELECT COUNT(*)::int AS n FROM citation_edges\");
    console.log('citation_edges', r.rows[0].n);
  }catch(e){console.log('citation_edges err', e.message);}
  await p.end();
})();" 2>/dev/null || echo "graph count skip"
fi

if [ -f /opt/Jurexio/secrets/.env.production ]; then
  echo "=== JRX GATEWAY ==="
  CANON=/opt/Jurexio/secrets/.env.production
  API=https://api.jurexio.com
  NSPK=$(grep -E '^JRX_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')

  echo "--- CNR via JRX SDK (caseCreate) ---"
  code=$(curl -sS -o /tmp/jrx-cnr.json -w '%{http_code}' -m 60 -X POST \
    -H "X-API-Key: ${NSPK}" -H 'Content-Type: application/json' \
    -d '{"cnr":"RJHC010324382023","options":{"profile":"caseCreate","includeDocuments":false},"claimEcourts":false}' \
    "${API}/api/jrx/v1/sdk/cnr/resolve" || echo 000)
  python3 - <<PY
import json
try:
  d=json.load(open("/tmp/jrx-cnr.json"))
  inner=d.get("data") if isinstance(d.get("data"), dict) else d
  cc=(inner.get("caseCreate") or {})
  print("nyv_cnr http=$code found=%s status=%s source=%s caseCreate=%s claimEcourts=%s" % (
    "$code", inner.get("found"), inner.get("status"), inner.get("source"), "yes" if cc else "no", inner.get("claimEcourts")))
  if cc:
    print("timeline_len=%s manifest=%s" % (len(cc.get("timeline") or []), (cc.get("fieldManifest") or {}).get("complete")))
except Exception as e:
  print("nyv_cnr parse err", e)
PY

  echo "--- NSP Pro CNR smoke (TSWL) ---"
  code2=$(curl -sS -o /tmp/jrx-cnr2.json -w '%{http_code}' -m 60 -X POST \
    -H "X-API-Key: ${NSPK}" -H 'Content-Type: application/json' \
    -d '{"cnr":"TSWL000000742024","claimEcourts":false}' \
    "${API}/api/jrx/v1/sdk/cnr/resolve" || echo 000)
  python3 - <<PY
import json
try:
  d=json.load(open("/tmp/jrx-cnr2.json"))
  inner=d.get("data") if isinstance(d.get("data"), dict) else d
  print("nsp_cnr http=$code2 found=%s matched=%s court=%s src=%s" % (
    "$code2", inner.get("found"), inner.get("matched"), inner.get("courtType"), inner.get("sourceArchive") or inner.get("source")))
except Exception as e:
  print("nsp_cnr parse err", e)
PY

  echo "--- knowledge plane ---"
  code3=$(curl -sS -o /tmp/kp.json -w '%{http_code}' -m 20 -H "X-API-Key: ${NSPK}" \
    "${API}/api/jrx/knowledge/health" || echo 000)
  python3 - <<PY
import json
try:
  d=json.load(open("/tmp/kp.json"))
  print("knowledge_health http=$code3 status=%s nys=%s" % ("$code3", d.get("status"), d.get("nys")))
except Exception as e:
  print("knowledge_health http=$code3 err=%s" % e)
PY

  echo "--- research-138 orchestrate probe (authority check) ---"
  code4=$(curl -sS -o /tmp/orch138.json -w '%{http_code}' -m 180 -X POST \
    -H "X-API-Key: ${NSPK}" -H 'Content-Type: application/json' \
    -d '{"taskType":"legal_research","jurisdiction":"IN","tier":"pro","prompt":"What are the leading Supreme Court authorities on the presumption under Section 139 of the Negotiable Instruments Act, and how has the burden of rebuttal been described? Cite the cases."}' \
    "${API}/api/jrx/orchestrate" || echo 000)
  python3 - <<PY
import json,re
try:
  d=json.load(open("/tmp/orch138.json"))
  body=d.get("response") or d.get("data",{}).get("response") or d.get("result") or ""
  if isinstance(body, dict): body=body.get("content") or str(body)
  cites=len(re.findall(r'\(\d{4}\)\s*\d+\s*S\.?C\.?\.?R', str(body)))
  print("orch138 http=$code4 chars=%s reporter_cites=%s" % ("$code4", len(str(body)), cites))
except Exception as e:
  print("orch138 parse err", e)
PY
fi
