#!/usr/bin/env bash
# nv-nightly-agentic-smoke.sh — Nightly partner smoke + AdaptiveRouter orch probes (EC2).
#
# Catches regressions without full UAT:
#   1) partner:smoke:ec2 (SKU surface)
#   2) orch lean → specialist
#   3) orch OCR → doc-pipeline
#   4) orch research → queen (best-effort; long timeout)
#
# Usage:
#   npm run smoke:nightly:ec2
#   NV_TARGET=ec2 bash scripts/jrx-nightly-agentic-smoke.sh
#
# Secrets: loads NYV_SDK_KEY_NSP from .env or ../.local/secrets/* (never echoes values).
# Exit non-zero on partner smoke failure or lean/ocr routing mismatch.

set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
STAMP="$(date -u +%Y-%m-%dT%H%MZ)"
OUT_DIR="${NV_SMOKE_OUT:-$ROOT/docs/audit/nightly-smoke}"
mkdir -p "$OUT_DIR"
REPORT="$OUT_DIR/nightly-$STAMP.json"

load_keys() {
  set -a
  [[ -f .env ]] && source .env || true
  [[ -f ../.local/secrets/runtime.env ]] && source ../.local/secrets/runtime.env || true
  [[ -f ../.local/secrets/ec2-keys-from-keysyaml.env ]] && source ../.local/secrets/ec2-keys-from-keysyaml.env || true
  [[ -f ../.local/secrets/ecosystem-shared-integration.env ]] && source ../.local/secrets/ecosystem-shared-integration.env || true
  set +a
}

load_keys
export NV_TARGET="${NV_TARGET:-ec2}"
BASE="${NV_BASE_URL:-https://api.nyayasiddhi.online}"
BASE="${BASE%/}"
KEY="${NYV_SDK_KEY_NSP:-${NYV_SDK_KEY_SHARED:-${NYV_SDK_KEY:-}}}"
if [[ -z "$KEY" ]]; then
  echo "[nightly] FATAL: no NSP SDK key in env" >&2
  exit 2
fi

FAIL=0
declare -a NOTES=()

echo "==> [1/4] partner:smoke:ec2"
if NV_TARGET=ec2 bash scripts/jrx-partner-smoke.sh; then
  NOTES+=("partner_smoke=PASS")
else
  NOTES+=("partner_smoke=FAIL")
  FAIL=1
fi

orch_probe() {
  local name="$1" body="$2" expect_path="$3"
  local out="/tmp/nyv-nightly-$name.json"
  local code
  code=$(curl -sS -m "${NV_ORCH_TIMEOUT:-540}" -o "$out" -w '%{http_code}' \
    -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
    "$BASE/api/jrx/orchestrate" -d "$body" || echo "000")
  local path
  path=$(python3 -c "import json;d=json.load(open('$out'));data=d.get('data') or d;r=data.get('routing') or {};print(r.get('path') or '')" 2>/dev/null || echo "")
  local qe
  qe=$(python3 -c "import json;d=json.load(open('$out'));data=d.get('data') or d;q=data.get('qualityEnvelope') or {};print(q.get('ok'))" 2>/dev/null || echo "")
  echo "    $name HTTP=$code path=$path qe=$qe expect=$expect_path"
  if [[ "$code" != "200" ]]; then
    NOTES+=("${name}=HTTP_$code")
    FAIL=1
    return
  fi
  if [[ -n "$expect_path" && "$path" != "$expect_path" ]]; then
    NOTES+=("${name}=path_$path!=$expect_path")
    FAIL=1
    return
  fi
  NOTES+=("${name}=PASS")
}

echo "==> [2/4] orch lean → specialist"
orch_probe lean '{"prompt":"Hello","taskType":"chat","partnerSyncLean":true,"agentKey":"legal-researcher"}' specialist

echo "==> [3/4] orch OCR → doc-pipeline"
orch_probe ocr '{"prompt":"Run OCR on this scanned petition PDF page text sample","taskType":"ocr"}' doc-pipeline

echo "==> [4/4] orch research → queen (best-effort)"
# Queen path may vary with complexity assessment; accept queen OR specialist with content
code=$(curl -sS -m "${NV_ORCH_TIMEOUT:-200}" -o /tmp/nyv-nightly-research.json -w '%{http_code}' \
  -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  "$BASE/api/jrx/orchestrate" \
  -d '{"prompt":"Provide a brief research note on Section 138 NI Act with one leading precedent. Keep under 200 words.","taskType":"research","enableCoT":true}' || echo "000")
python3 - <<'PY' || true
import json
d=json.load(open('/tmp/nyv-nightly-research.json'))
data=d.get('data') or d
r=data.get('routing') or {}
path=r.get('path')
qe=(data.get('qualityEnvelope') or {}).get('ok')
osdepth=data.get('osDepth') or {}
print(f"    research HTTP path={path} qe={qe} cot={osdepth.get('queenCotApplied')} ctx={bool(osdepth.get('contextEngineering'))}")
open('/tmp/nyv-nightly-research.meta','w').write(json.dumps({"path":path,"qe":qe,"osDepth":osdepth}))
PY
if [[ "$code" != "200" ]]; then
  NOTES+=("research=HTTP_$code")
  FAIL=1
else
  NOTES+=("research=HTTP_200")
fi

# Health
hcode=$(curl -sS -m 20 -o /tmp/nyv-nightly-health.json -w '%{http_code}' "$BASE/api/jrx/health" || echo "000")
agents=$(python3 -c "import json;d=json.load(open('/tmp/nyv-nightly-health.json'));print(d.get('totalAgents'))" 2>/dev/null || echo "?")
NOTES+=("health=${hcode}_agents_${agents}")
[[ "$hcode" == "200" ]] || FAIL=1

python3 - <<PY
import json, os
report={
  "stamp": "$STAMP",
  "base": "$BASE",
  "fail": int("$FAIL"),
  "notes": """${NOTES[*]}""".split(),
}
open("$REPORT","w").write(json.dumps(report, indent=2))
print("==> report", "$REPORT")
print(json.dumps(report, indent=2))
PY

if [[ "$FAIL" != "0" ]]; then
  echo "[nightly] FAILED" >&2
  exit 1
fi
echo "[nightly] PASS"
exit 0
