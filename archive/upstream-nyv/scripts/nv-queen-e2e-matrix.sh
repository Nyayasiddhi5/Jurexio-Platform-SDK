#!/usr/bin/env bash
# nv-queen-e2e-matrix.sh — Multi-agent Queen + AdaptiveRouter scenario matrix
# for Legal, Document Intelligence, and multi-agent patterns.
#
# Usage:
#   npm run smoke:queen:matrix:ec2
#   NV_TARGET=ec2 bash scripts/jrx-queen-e2e-matrix.sh
#
# Exit non-zero if any HARD scenario fails (HTTP != 200 or expected path miss).
# SOFT scenarios (long Queen research) record outcome but do not fail the job
# unless NYV_MATRIX_STRICT=1.

set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
STAMP="$(date -u +%Y-%m-%dT%H%MZ)"
OUT_DIR="${NV_MATRIX_OUT:-$ROOT/docs/audit/queen-matrix}"
mkdir -p "$OUT_DIR"
REPORT="$OUT_DIR/queen-matrix-$STAMP.json"

set -a
[[ -f .env ]] && source .env || true
[[ -f ../.local/secrets/runtime.env ]] && source ../.local/secrets/runtime.env || true
[[ -f ../.local/secrets/ec2-keys-from-keysyaml.env ]] && source ../.local/secrets/ec2-keys-from-keysyaml.env || true
set +a

BASE="${NV_BASE_URL:-https://api.nyayasiddhi.online}"
BASE="${BASE%/}"
KEY="${NYV_SDK_KEY_NSP:-${NYV_SDK_KEY_SHARED:-${NYV_SDK_KEY:-}}}"
if [[ -z "$KEY" ]]; then
  echo "[matrix] FATAL: no SDK key" >&2
  exit 2
fi

TIMEOUT="${NV_ORCH_TIMEOUT:-540}"
STRICT="${NYV_MATRIX_STRICT:-0}"
FAIL=0
RESULTS=()

run_case() {
  local name="$1" hardness="$2" expect_path="$3" body="$4"
  local out="/tmp/nyv-matrix-$name.json"
  local code
  code=$(curl -sS -m "$TIMEOUT" -o "$out" -w '%{http_code}' \
    -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
    "$BASE/api/jrx/orchestrate" -d "$body" || echo "000")
  local path agents osDepth
  path=$(python3 -c "import json;d=json.load(open('$out'));data=d.get('data') or d;r=data.get('routing') or {};print(r.get('path') or '')" 2>/dev/null || echo "")
  agents=$(python3 -c "import json;d=json.load(open('$out'));data=d.get('data') or d;a=data.get('agentsUsed') or [];print(len(a) if isinstance(a,list) else 0)" 2>/dev/null || echo "0")
  osDepth=$(python3 -c "import json;d=json.load(open('$out'));data=d.get('data') or d;o=data.get('osDepth') or {};print(o.get('path') or '')" 2>/dev/null || echo "")
  local ok=1
  if [[ "$code" != "200" ]]; then ok=0; fi
  if [[ -n "$expect_path" && "$path" != "$expect_path" ]]; then ok=0; fi
  echo "  [$hardness] $name HTTP=$code path=$path agents=$agents osDepth=$osDepth expect=$expect_path ok=$ok"
  RESULTS+=("{\"name\":\"$name\",\"hardness\":\"$hardness\",\"http\":$code,\"path\":\"$path\",\"agents\":$agents,\"osDepth\":\"$osDepth\",\"expect\":\"$expect_path\",\"ok\":$ok}")
  if [[ "$ok" -eq 0 ]]; then
    if [[ "$hardness" == "HARD" || "$STRICT" == "1" ]]; then
      FAIL=1
    fi
  fi
}

echo "==> Queen / AdaptiveRouter E2E matrix → $BASE (timeout=${TIMEOUT}s)"

# HARD — routing must match AdaptiveRouter contract
run_case "lean_specialist" HARD "specialist" \
  '{"prompt":"What is Section 302 BNS penalty in one sentence?","agentKey":"generic","preferences":{"partnerSyncLean":true}}'

run_case "ocr_doc_pipeline" HARD "doc-pipeline" \
  '{"prompt":"Run OCR on the uploaded scanned petition and extract text","taskType":"ocr"}'

run_case "compare_docs" HARD "" \
  '{"prompt":"Compare these two contracts clause by clause for indemnity differences","taskType":"compare"}'

# HARD — multi-agent modes forced
run_case "queen_parallel_legal" HARD "queen" \
  '{"prompt":"Multi-agent: research Supreme Court precedents on anticipatory bail under BNSS, draft a brief outline, and verify citations.","orchestrationMode":"parallel","enableCoT":true}'

run_case "queen_hierarchical_research" HARD "queen" \
  '{"prompt":"Hierarchical research: manager plan then workers — analyse GST ITC dispute strategy for Indian MSME with case law.","orchestrationMode":"hierarchical","enableCoT":true}'

run_case "queen_sequential_draft" HARD "queen" \
  '{"prompt":"Sequential: outline then draft a notice under Section 138 NI Act for India.","orchestrationMode":"sequential","taskType":"draft"}'

# SOFT — quality probes (path may vary; long wall clock)
run_case "doc_intelligence_summarize" SOFT "" \
  '{"prompt":"Summarise this legal document for a senior partner focusing on risk clauses","taskType":"summarize"}'

run_case "rag_caselaw_research" SOFT "queen" \
  '{"prompt":"Find and cite three Indian Supreme Court cases on Section 498A misuse with holdings.","taskType":"research","enableRAG":true,"enableCoT":true}'

run_case "swarm_compliance" SOFT "queen" \
  '{"prompt":"Swarm: DPDPA compliance checklist for a SaaS legal AI product storing Indian PII.","orchestrationMode":"swarm"}'

{
  echo "{"
  echo "  \"stamp\": \"$STAMP\","
  echo "  \"base\": \"$BASE\","
  echo "  \"timeoutSec\": $TIMEOUT,"
  echo "  \"fail\": $FAIL,"
  echo "  \"cases\": ["
  local i=0
  for r in "${RESULTS[@]}"; do
    [[ $i -gt 0 ]] && echo ","
    echo -n "    $r"
    i=$((i+1))
  done
  echo ""
  echo "  ]"
  echo "}"
} > "$REPORT"

echo "==> Report: $REPORT fail=$FAIL"
exit "$FAIL"
