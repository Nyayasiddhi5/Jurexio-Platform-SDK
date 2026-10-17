#!/bin/sh
# Readiness sweep: hit every partner AI surface NSP/NYM actually use and report
# status + latency, so "are we ready?" is answered by responses, not by opinion.
# Positive control: NSP key >=16 chars; a 000 code means the probe failed, not the
# platform.

CANON=/opt/Nyayavigya/secrets/.env.production
K=`grep -E '^NYV_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "\r\n"`
if [ `printf %s "$K" | wc -c` -lt 16 ]; then echo "PROBE BROKEN: no NSP key"; exit 3; fi
B=https://api.nyayasiddhi.online
H_AUTH="X-API-Key: $K"

g() { # GET  $1=label $2=path
  printf '%-34s ' "$1"
  curl -sS -m 60 -o /tmp/o.json -w "http=%{http_code} t=%{time_total}s" \
    -H "$H_AUTH" -H "X-NYV-Platform: nsp" -H "X-Customer-User-Id: probe-user-1" "$B$2"
  printf ' bytes=%s\n' "`wc -c < /tmp/o.json | tr -d ' '`"
}
p() { # POST $1=label $2=path $3=json
  printf '%-34s ' "$1"
  curl -sS -m 180 -o /tmp/o.json -w "http=%{http_code} t=%{time_total}s" -X POST \
    -H "$H_AUTH" -H "X-NYV-Platform: nsp" -H "X-NYV-Consent: granted" \
    -H "X-Customer-User-Id: probe-user-1" -H "Content-Type: application/json" \
    -d "$3" "$B$2"
  printf ' bytes=%s\n' "`wc -c < /tmp/o.json | tr -d ' '`"
}

echo "===== health / catalog ====="
g "gateway health"        "/api/jrx/gateway/health"
g "platform health"       "/api/jrx/health"
g "openapi spec"          "/api/jrx/openapi.json"
g "gateway usage"         "/api/jrx/gateway/usage"

echo "===== retrieval (zero/low LLM — must be fast) ====="
g "statutes typeahead"    "/api/jrx/knowledge/statutes/search?q=anticipatory%20bail&limit=5"
g "caselaw typeahead"     "/api/jrx/knowledge/caselaw/search?q=bail&limit=5&mode=fts"
g "templates"             "/api/jrx/knowledge/templates?limit=5"
p "IPC->BNS mapping"      "/api/jrx/knowledge/statutes/compare/ipc-bns" '{"section":"302","from":"IPC"}'
p "knowledge search"      "/api/jrx/knowledge/search" '{"query":"anticipatory bail BNSS 482","jurisdiction":"IN"}'
p "citation verify"       "/api/jrx/knowledge/caselaw/verify-citation" '{"citation":"(2011) 1 SCC 694","jurisdiction":"IN"}'
p "cnr resolve"           "/api/jrx/v1/sdk/cnr/resolve" '{"cnr":"TSWL010000012024"}'

echo "===== generation (the AI tasks) ====="
p "legal-draft-fast"      "/api/jrx/orchestrate" '{"prompt":"Draft a short Written Statement for recovery of money.","taskType":"legal-draft-fast","jurisdiction":"IN"}'
p "legal-chat-fast"       "/api/jrx/orchestrate" '{"prompt":"Grounds for anticipatory bail under BNSS 482?","taskType":"legal-chat-fast","jurisdiction":"IN"}'
p "doc-draft-fast"        "/api/jrx/orchestrate" '{"prompt":"Draft a legal notice for unpaid invoice of Rs 12 lakh.","taskType":"doc-draft-fast","jurisdiction":"IN"}'
p "gateway research"      "/api/jrx/gateway/research/query" '{"query":"Is anticipatory bail available in PMLA matters?","jurisdiction":"IN"}'

echo "===== documents / intelligence ====="
p "docs summarize"        "/api/jrx/sdk/docs-pipeline/documents/summarize" '{"text":"This agreement is between A and B for supply of goods worth Rs 50 lakh, term 24 months, governed by Indian law.","jurisdiction":"IN"}'
p "classify document"     "/api/jrx/v1/sdk/intelligence/classify-document" '{"text":"THIS DEED OF LEASE is made between the Lessor and the Lessee...","jurisdiction":"IN"}'
p "legal NER"             "/api/jrx/intelligence/legal-ner" '{"text":"Ram Kumar filed a petition under BNSS 482 before the Telangana High Court.","jurisdiction":"IN"}'
g "patra-mitra health"    "/api/jrx/v1/sdk/patra-mitra/health"
g "matter-vault health"   "/api/jrx/matter-vault/health"
g "legal feed"            "/api/jrx/v1/sdk/legal-intelligence/feed?jurisdiction=IN"

echo "===== partner-visible tracking fields on a generation call ====="
python3 - <<'PY'
import json
try:
    d = json.load(open('/tmp/o.json'))
except Exception as e:
    print('  (last body not JSON: %s)' % e); raise SystemExit
print('  last-probe keys present:', sorted(k for k in (d.get('data') or {}) if k in
      ('requestId','requestPhase','sessionId','orchestrationId','riskBadge','auditHash','qualityEnvelope','cost')))
PY

echo "===== error hygiene in the last 15 min ====="
LOG=`docker logs nyv-gateway --since 15m 2>&1`
for pat in "AI_SERVICE_UNAVAILABLE" "mandatory steps missing" "persistent decision-log write failed" \
           "NYV-SESSION-POOLING-001" "UnhandledPromiseRejection" "value too long" "recall budget exhausted"; do
  printf '  %-38s %s\n' "$pat" "`printf '%s' "$LOG" | grep -c "$pat"`"
done
echo "  control: log_lines=`printf '%s' "$LOG" | wc -l`"
docker inspect nyv-gateway --format '  gateway restarts={{.RestartCount}} oom={{.State.OOMKilled}}'
