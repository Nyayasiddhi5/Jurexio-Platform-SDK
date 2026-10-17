#!/bin/bash
# nv-smoke-bash.sh — pure-bash parallel SDK smoke for all 7 platforms.
# Usage: bash scripts/jrx-smoke-bash.sh [gateway-url]
# Env requires: NYV_SDK_KEY_{NSP,NSPM,NSI,NSM,NSA,NYM,JRX}
set -uo pipefail
GW="${1:-http://localhost:5000}"
mkdir -p audit
STAMP=$(date -u +%Y-%m-%dT%H%M%SZ)
LEDGER="audit/smoke-bash-${STAMP}.json"
TMPDIR=$(mktemp -d)
trap "rm -rf $TMPDIR" EXIT

declare -A KEY=(
  [NSP]="${NYV_SDK_KEY_NSP:-}"   [NSPM]="${NYV_SDK_KEY_NSPM:-}" [NSI]="${NYV_SDK_KEY_NSI:-}"
  [NSM]="${NYV_SDK_KEY_NSM:-}"   [NSA]="${NYV_SDK_KEY_NSA:-}"   [NYM]="${NYV_SDK_KEY_NYM:-}"
  [JRX]="${NYV_SDK_KEY_JRX:-}"
)
# Platform filter — NV-SDK-UNIFIED-001 (Session-15 v3): the smoke harness
# uses the SAME endpoints for every platform; differentiation is by SDK key
# only. Default = full ecosystem; for the user-mandated NSP-Web/NSP-Mobile/
# NYM scope set:  PLATFORMS_FILTER=NSP,NSPM,NYM bash scripts/jrx-smoke-bash.sh
PLATFORMS_FILTER="${PLATFORMS_FILTER:-NSP,NSPM,NSI,NSM,NSA,NYM,JRX}"
# shellcheck disable=SC2207
PLATFORMS=($(echo "$PLATFORMS_FILTER" | tr ',' ' '))
echo "── Platforms in scope: ${PLATFORMS[*]} ──"
DOCS_GRANT=(NSP NSPM NSI NSM JRX NYM NSA)
ENT_GRANT=(NSI NSM JRX)
RESEARCH_GRANT=(NSP NSPM NSI NSM NSA JRX)

probe() {
  local name="$1" method="$2" url="$3" exp="$4" key="$5" body="$6"
  local hdrs=(); [[ -n "$key" ]] && hdrs+=(-H "X-API-Key: $key")
  [[ -n "$body" ]] && hdrs+=(-H "Content-Type: application/json" --data-binary "@$body")
  local t0=$(date +%s%3N)
  local code
  code=$(curl -sS -o /dev/null --max-time 25 -X "$method" -w '%{http_code}' "${hdrs[@]}" "$url" 2>/dev/null) || code="000"
  local ms=$(( $(date +%s%3N) - t0 ))
  local status="FAIL"; [[ "$code" =~ ^($exp)$ ]] && status="PASS"
  printf '{"name":"%s","method":"%s","url":"%s","expected":"%s","actual":"%s","status":"%s","ms":%d}\n' \
    "$name" "$method" "$url" "$exp" "$code" "$status" "$ms" >> "$TMPDIR/results.jsonl"
  printf "  [%s] %-50s %s (%dms)\n" "$status" "$name" "$code" "$ms"
}

echo '{"query":"IPC 420","jurisdiction":"IN"}'                                  > "$TMPDIR/q-research.json"
echo '{"text":"Hello","targetLanguage":"hi","sourceLanguage":"en"}'             > "$TMPDIR/q-translate.json"
echo '{"text":"Sample contract clause about indemnification.","jurisdiction":"IN"}' > "$TMPDIR/q-docintel.json"
echo '{"query":"data protection","jurisdiction":"IN"}'                          > "$TMPDIR/q-entresearch.json"

echo "════════════════════════════════════════════════════════════════════════════"
echo " Bash All-Platforms Smoke — $STAMP   gateway=$GW"
echo "════════════════════════════════════════════════════════════════════════════"
echo "── 1. PUBLIC health ──"
probe "PUB.health"          GET  "$GW/health"                  "200" "" ""
probe "PUB.api/health"      GET  "$GW/api/jrx/health"           "200" "" ""
probe "PUB.health/full"     GET  "$GW/api/jrx/health/full"      "200|503" "" ""
probe "PUB.voice/info"      GET  "$GW/api/jrx/voice/info"       "200" "" ""

echo "── 2. Negative auth gating ──"
probe "NEG.gateway/health"  GET  "$GW/api/jrx/gateway/health"      "401" "" ""
probe "NEG.gateway/agents"  GET  "$GW/api/jrx/gateway/agents"      "401" "" ""
probe "NEG.docs/library"    GET  "$GW/api/jrx/sdk/docs-pipeline/clauses/library" "401" "" ""
probe "NEG.orchestrate"     POST "$GW/api/jrx/orchestrate"         "401" "" "$TMPDIR/q-research.json"
probe "NEG.admin/health"    GET  "$GW/api/jrx/admin/health/full"   "401" "" ""
probe "NEG.bad-key"         GET  "$GW/api/jrx/gateway/agents"      "401" "nyv_test_sk_BOGUS_KEY" ""

echo "── 3. T6 provision/validate per platform ──"
for p in "${PLATFORMS[@]}"; do
  k="${KEY[$p]}"
  if [[ -z "$k" ]]; then printf "  [SKIP] VAL.%s.provision/validate (key missing)\n" "$p"; continue; fi
  echo "{\"api_key\":\"$k\"}" > "$TMPDIR/q-validate-$p.json"
  probe "VAL.$p.provision/validate" POST "$GW/api/jrx/sdk/provision/validate" "200" "" "$TMPDIR/q-validate-$p.json"
done

echo "── 4. METADATA per platform (parallel) ──"
PIDS=()
for p in "${PLATFORMS[@]}"; do
  k="${KEY[$p]}"; [[ -z "$k" ]] && continue
  (
    probe "META.$p.gateway/health"     GET  "$GW/api/jrx/gateway/health"                     "200" "$k" ""
    probe "META.$p.gateway/agents"     GET  "$GW/api/jrx/gateway/agents"                     "200" "$k" ""
    probe "META.$p.translate/langs"    GET  "$GW/api/jrx/gateway/translate/languages"        "200" "$k" ""
    probe "META.$p.gateway/usage"      GET  "$GW/api/jrx/gateway/usage"                      "200" "$k" ""
    probe "META.$p.multimodal/caps"    GET  "$GW/api/jrx/sdk/multimodal/multimodal/capabilities" "200" "$k" ""
    probe "META.$p.provision/health"   POST "$GW/api/jrx/sdk/provision/health"               "200|400" "$k" ""
  ) &
  PIDS+=($!)
done
wait "${PIDS[@]}"

echo "── 5. Docs-pipeline scope-gate (parallel) ──"
PIDS=()
for p in "${PLATFORMS[@]}"; do
  k="${KEY[$p]}"; [[ -z "$k" ]] && continue
  if [[ " ${DOCS_GRANT[*]} " == *" $p "* ]]; then exp="200"; else exp="403"; fi
  (
    probe "DOC.$p.clauses/library($exp)"     GET  "$GW/api/jrx/sdk/docs-pipeline/clauses/library"     "$exp" "$k" ""
    probe "DOC.$p.documents/templates($exp)" GET  "$GW/api/jrx/sdk/docs-pipeline/documents/templates" "$exp" "$k" ""
  ) &
  PIDS+=($!)
done
wait "${PIDS[@]}"

echo "── 6. LLM-backed (parallel; bounded 25s curl per call) ──"
PIDS=()
for p in "${PLATFORMS[@]}"; do
  k="${KEY[$p]}"; [[ -z "$k" ]] && continue
  (
    if [[ " ${RESEARCH_GRANT[*]} " == *" $p "* ]]; then
      probe "LLM.$p.research/query"      POST "$GW/api/jrx/gateway/research/query"   "200" "$k" "$TMPDIR/q-research.json"
    else
      probe "LLM.$p.research/query(403)" POST "$GW/api/jrx/gateway/research/query"   "403" "$k" "$TMPDIR/q-research.json"
    fi
    probe "LLM.$p.translate"        POST "$GW/api/jrx/gateway/translate"        "200" "$k" "$TMPDIR/q-translate.json"
    if [[ " ${DOCS_GRANT[*]} " == *" $p "* ]]; then
      probe "LLM.$p.docintel"       POST "$GW/api/jrx/sdk/docs-pipeline/documents/intelligence" "200|400" "$k" "$TMPDIR/q-docintel.json"
    else
      probe "LLM.$p.docintel(403)"  POST "$GW/api/jrx/sdk/docs-pipeline/documents/intelligence" "403"     "$k" "$TMPDIR/q-docintel.json"
    fi
    if [[ " ${ENT_GRANT[*]} " == *" $p "* ]]; then
      probe "LLM.$p.ent/research"   POST "$GW/api/jrx/sdk/enterprise/research/domain/legal" "200|400" "$k" "$TMPDIR/q-entresearch.json"
    else
      probe "LLM.$p.ent/research(403)" POST "$GW/api/jrx/sdk/enterprise/research/domain/legal" "403"  "$k" "$TMPDIR/q-entresearch.json"
    fi
  ) &
  PIDS+=($!)
done
wait "${PIDS[@]}"

echo "════════════════════════════════════════════════════════════════════════════"
TOT=$(wc -l < "$TMPDIR/results.jsonl"); PASS=$(grep -c '"status":"PASS"' "$TMPDIR/results.jsonl" || echo 0); FAIL=$((TOT-PASS))
echo "  Result: $PASS PASS / $FAIL FAIL  (total $TOT)"
echo "  Audit:  $LEDGER"
{
  echo "{\"timestamp\":\"$STAMP\",\"gateway\":\"$GW\",\"summary\":{\"pass\":$PASS,\"fail\":$FAIL,\"total\":$TOT},\"results\":["
  paste -sd, "$TMPDIR/results.jsonl"
  echo "]}"
} > "$LEDGER"
if [[ $FAIL -gt 0 ]]; then echo ""; echo "── FAILURES ──"; grep '"status":"FAIL"' "$TMPDIR/results.jsonl"; fi
echo "════════════════════════════════════════════════════════════════════════════"
exit $FAIL
