#!/usr/bin/env bash
# NSP blockers "BEFORE" probe — NYV-7/8/9 (503 surfaces) + NYV-10 (hybrid latency)
# + NYV-11 (verify-citation shape). Uses host curl against the gateway container.
# Positive controls: PC=5150 prints; /api/jrx/health MUST return 200 (proves the
# instrument reaches the gateway); a 000 or 2ms HTML answer means the probe is wrong.
set -uo pipefail
OUT=/tmp/nsp-before.txt
: > "$OUT"
echo "PC=5150" | tee -a "$OUT"

KEY=$(docker exec nyv-gateway sh -lc 'printf %s "$NYV_SDK_KEY_NSP"')
echo "key_len=${#KEY}" | tee -a "$OUT"
if [ "${#KEY}" -ne 64 ]; then echo "PROBE_BROKEN: key_len!=64" | tee -a "$OUT"; exit 1; fi

GW=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' nyv-gateway)
BASE="http://${GW}:5000"
echo "gateway_ip_resolved=$([ -n "$GW" ] && echo yes || echo NO_PROBE_BROKEN) base=$BASE" | tee -a "$OUT"

H_KEY=(-H "x-api-key: $KEY" -H "x-nyv-platform: nsp" -H "x-nyv-consent: granted" -H "content-type: application/json")

hit() { # label method path [body] [timeout]
  local label="$1" method="$2" path="$3" body="${4:-}" tmo="${5:-30}"
  local f; f=$(mktemp)
  local code tt
  if [ -n "$body" ]; then
    read -r code tt < <(curl -sS -o "$f" -w '%{http_code} %{time_total}' -m "$tmo" -X "$method" "${H_KEY[@]}" -d "$body" "$BASE$path" 2>/dev/null || echo "000 0")
  else
    read -r code tt < <(curl -sS -o "$f" -w '%{http_code} %{time_total}' -m "$tmo" -X "$method" "${H_KEY[@]}" "$BASE$path" 2>/dev/null || echo "000 0")
  fi
  { echo "--- $label"; echo "http=$code time=${tt}s $method $path"; echo "body_head:"; head -c 1400 "$f"; echo; } >> "$OUT"
  rm -f "$f"
}

# ── POSITIVE CONTROL ───────────────────────────────────────────────────────────
hit "PC-health" GET /api/jrx/health
hit "PC-noauth-must-401" GET /api/jrx/matter-vault/packs "" 15 # (still sends key; separate below)
f=$(mktemp); nc=$(curl -sS -o "$f" -w '%{http_code}' -m 15 "$BASE/api/jrx/matter-vault/packs" 2>/dev/null || echo 000)
{ echo "--- PC-truly-noauth (expect 401)"; echo "http=$nc"; head -c 400 "$f"; echo; } >> "$OUT"; rm -f "$f"

# ── NYV-7 Matter Vault ─────────────────────────────────────────────────────────
hit "NYV7-mv-root"     GET  /api/jrx/matter-vault
hit "NYV7-mv-packs"    GET  /api/jrx/matter-vault/packs
hit "NYV7-mv-matters"  GET  /api/jrx/matter-vault/matters
hit "NYV7-mv-create"   POST /api/jrx/matter-vault/packs '{"name":"NSP probe pack","jurisdiction":"IN"}'

# ── NYV-8 legal-work/evaluate ──────────────────────────────────────────────────
hit "NYV8-lw-tasks"    GET  /api/jrx/legal-work/tasks
hit "NYV8-lw-runs"     GET  /api/jrx/legal-work/runs
hit "NYV8-lw-evaluate" POST /api/jrx/legal-work/evaluate '{"instruction":"Summarise the limitation period for a suit on a promissory note in India."}' 60

# ── NYV-9 compliance evidence-pack ─────────────────────────────────────────────
hit "NYV9-cmp-health"  GET  /api/jrx/compliance/health
hit "NYV9-cmp-evpack"  GET  /api/jrx/compliance/evidence-pack 60
hit "NYV9-cmp-evpack-post" POST /api/jrx/compliance/evidence-pack '{"frameworks":"ISO42001,SOC2"}' 60

# ── NYV-11 verify-citation + treatment ─────────────────────────────────────────
hit "NYV11-verify" POST /api/jrx/knowledge/caselaw/verify-citation '{"citation":"AIR 1973 SC 1461"}' 45
hit "NYV11-treatment" GET "/api/jrx/knowledge/caselaw/treatment?citation=AIR%201973%20SC%201461" "" 45

# ── NYV-10 hybrid vs fts latency (3 runs each) ─────────────────────────────────
for i in 1 2 3; do
  hit "NYV10-fts-$i"    GET "/api/jrx/knowledge/caselaw/search?q=anticipatory%20bail&mode=fts&limit=10" "" 45
  hit "NYV10-hybrid-$i" GET "/api/jrx/knowledge/caselaw/search?q=anticipatory%20bail&mode=hybrid&limit=10" "" 60
done

echo "DONE=5150" >> "$OUT"
wc -c "$OUT"
echo "=== PART1 ==="; head -c 12000 "$OUT"
