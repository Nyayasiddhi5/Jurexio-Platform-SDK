#!/usr/bin/env bash
# NV-BENCH-COST-001 (host side) — measure ONE benchmark item on live nysdev.
#
# Runs on the EC2 host, driven by `scripts/jrx-benchmark-cost.mjs` over SSM. It is
# deliberately one item per invocation:
#   - the Queen/swarm item alone takes ~366 s (§12.1), so a whole-set loop would
#     blow the SSM timeout and lose every earlier result with it;
#   - the ground-truth log window has to bracket exactly one request, otherwise
#     concurrent traffic on a shared dev host is counted as this request's fan-out.
#
# The host has no repo checkout and no node (verified: python3 3.12 + docker only),
# so the driver ships this file, the frozen set item, and the ONE canonical
# provider-log extractor (`_nv-provider-usage-extract.py`) as base64 payloads.
#
# NV-SECRETS-001: keys are read from the canonical env file into locals and are
# never printed, never written to an artifact, never placed in a URL that is
# echoed. Only key PRESENCE is reported.
set -uo pipefail

CANON="${NVB_CANON:-/opt/Nyayavigya/secrets/.env.production}"
API="${NVB_API:-https://api.nyayasiddhi.online}"
WORK="${NVB_WORK:-/tmp/jrx-bench}"
EXTRACT="${WORK}/_nv-provider-usage-extract.py"
ITEM_JSON="${WORK}/item.json"
TIMEOUT="${NVB_TIMEOUT:-880}"
MAXOUT="${NVB_MAX_OUT:-2048}"
DIRECT_MODEL="${NVB_DIRECT_MODEL:-gemini-3.1-pro-preview}"
DO_DIRECT="${NVB_DIRECT:-1}"
LOG_SETTLE="${NVB_LOG_SETTLE:-8}"

die() { echo "NVBENCH_FATAL $*"; exit 1; }

[ -f "$EXTRACT" ] || die "extractor missing at $EXTRACT (driver did not ship it)"
[ -f "$ITEM_JSON" ] || die "item payload missing at $ITEM_JSON"
[ -f "$CANON" ] || die "canonical env file missing at $CANON"

NSPK=$(grep -E '^NYV_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')
[ -n "$NSPK" ] || die "NYV_SDK_KEY_NSP absent from canonical env (cannot call the SDK surface)"
GK=$(grep -E '^(GEMINI_API_KEY|GOOGLE_API_KEY|GOOGLE_AI_API_KEY)=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')

GID=$(docker ps --filter 'name=gateway' --format '{{.ID}}' | head -1)
# Three other agents deploy to this host. A pass that starts mid-restart loses the
# item to "no gateway container" or to a 502, and one full pass already died that
# way at items 8-10. Wait for a healthy gateway instead of failing the item, and
# report the wait so a run that started during a deploy is visible.
WAITED=0
while [ -z "$GID" ] || [ "$(curl -s -o /dev/null -w '%{http_code}' -m 5 http://localhost:5000/health 2>/dev/null)" != "200" ]; do
  [ "$WAITED" -ge "${NVB_HEALTH_WAIT:-180}" ] && break
  sleep 6; WAITED=$((WAITED + 6))
  GID=$(docker ps --filter 'name=gateway' --format '{{.ID}}' | head -1)
done
[ -n "$GID" ] || die "no gateway container running after ${WAITED}s"
[ "$WAITED" -gt 0 ] && echo "NVBENCH_NOTE waited ${WAITED}s for a healthy gateway (deploy in flight?)"

# ── build under test ─────────────────────────────────────────────────────────
# Emitted on every item so a before/after pair can PROVE it compared two
# different builds. A benchmark whose "after" run silently hit the same image as
# the "before" run is worse than no benchmark.
if [ "${NVB_EMIT_BUILD:-0}" = "1" ]; then
  docker inspect --format '{{.Image}} {{.Created}} {{.Config.Image}}' "$GID" 2>/dev/null \
    | python3 -c "
import base64, gzip, json, sys
parts = sys.stdin.read().split()
payload = json.dumps({
    'imageSha': parts[0] if parts else None,
    'containerCreated': parts[1] if len(parts) > 1 else None,
    'configImage': parts[2] if len(parts) > 2 else None,
})
blob = base64.b64encode(gzip.compress(payload.encode())).decode()
chunks = [blob[i:i + 512] for i in range(0, len(blob), 512)] or ['']
for idx, chunk in enumerate(chunks):
    print(f'NVBENCH_BUILD_GZB64 {idx} {len(chunks)} {chunk}')
"
fi

# ── price table, read from the DEPLOYED catalog ───────────────────────────────
# Prices come from the code that is actually running, not from a second hardcoded
# table. `scripts/jrx-cost-model.py` keeps its own PRICE dict for *projections*;
# a measurement must not inherit a copy that can drift from the catalog.
if [ "${NVB_EMIT_PRICES:-0}" = "1" ]; then
  docker exec "$GID" cat /app/src/services/intelligent-router/model-catalog.ts 2>/dev/null \
    | python3 "${WORK}/_nv-catalog-prices.py"
fi

RUN_DIR="${WORK}/run-$(date +%s)-$$"
mkdir -p "$RUN_DIR"

BODY=$(python3 -c "
import json
item = json.load(open('${ITEM_JSON}'))
body = {'prompt': item['prompt'], 'jurisdiction': item.get('jurisdiction', 'IN')}
body.update(item.get('body') or {})
print(json.dumps(body))
")

# ── NYV orchestrated path ────────────────────────────────────────────────────
# Line-count delta brackets the request in the log stream. `--tail 400000` has to
# exceed the volume the gateway can emit while one swarm request runs, or the
# "before" offset scrolls off and the ground-truth count silently loses lines.
BEFORE=$(docker logs --tail 400000 "$GID" 2>&1 | wc -l | tr -d ' ')
T0=$(date +%s.%N)
HTTP=$(curl -sS -m "$TIMEOUT" -o "${RUN_DIR}/nyv.json" -w '%{http_code}' \
  -X POST -H "X-API-Key: ${NSPK}" -H 'Content-Type: application/json' \
  -H 'X-NYV-Consent: granted' -d "$BODY" "${API}/api/jrx/orchestrate" 2>/dev/null || echo "000")
T1=$(date +%s.%N)

# The last provider line can land after the HTTP response (the hedge-loser waste
# record is deliberately fire-and-forget, llm-orchestrator.ts:1199-1205), so a
# settle window is required or `wasted` reads as 0 whenever the abort is slow.
sleep "$LOG_SETTLE"
docker logs --tail 400000 "$GID" 2>&1 | tail -n +"$BEFORE" > "${RUN_DIR}/gw.log"

REQID=$(python3 -c "
import json
try:
    d = json.load(open('${RUN_DIR}/nyv.json'))
except Exception:
    print(''); raise SystemExit
d = d.get('data') if isinstance(d.get('data'), dict) else d
print(d.get('requestId') or '')
" 2>/dev/null)

if [ -n "$REQID" ]; then
  python3 "$EXTRACT" --request-id "$REQID" < "${RUN_DIR}/gw.log" > "${RUN_DIR}/truth.json" 2>/dev/null \
    || echo '{}' > "${RUN_DIR}/truth.json"
else
  python3 "$EXTRACT" < "${RUN_DIR}/gw.log" > "${RUN_DIR}/truth.json" 2>/dev/null \
    || echo '{}' > "${RUN_DIR}/truth.json"
fi

# ── direct provider baseline: same model, raw user prompt, no scaffolding ─────
DHTTP="skipped"; D0=0; D1=0
if [ "$DO_DIRECT" = "1" ] && [ -n "$GK" ]; then
  python3 -c "
import json
item = json.load(open('${ITEM_JSON}'))
print(json.dumps({
    'contents': [{'parts': [{'text': item['prompt']}]}],
    'generationConfig': {'maxOutputTokens': ${MAXOUT}},
}))
" > "${RUN_DIR}/direct-req.json"
  D0=$(date +%s.%N)
  DHTTP=$(curl -sS -m 300 -o "${RUN_DIR}/direct.json" -w '%{http_code}' \
    -X POST -H 'Content-Type: application/json' -d "@${RUN_DIR}/direct-req.json" \
    "https://generativelanguage.googleapis.com/v1beta/models/${DIRECT_MODEL}:generateContent?key=${GK}" 2>/dev/null || echo "000")
  D1=$(date +%s.%N)
elif [ "$DO_DIRECT" = "1" ]; then
  DHTTP="no-key"
fi

# ── assemble one compact result record ───────────────────────────────────────
NVB_HTTP="$HTTP" NVB_DHTTP="$DHTTP" NVB_W0="$T0" NVB_W1="$T1" NVB_D0="$D0" NVB_D1="$D1" \
NVB_RUN_DIR="$RUN_DIR" NVB_DIRECT_MODEL="$DIRECT_MODEL" NVB_ITEM_PATH="$ITEM_JSON" \
NVB_RUN="${NVB_RUN:-1}" python3 - <<'PY'
import base64, gzip, json, os

run_dir = os.environ['NVB_RUN_DIR']


def load(name):
    try:
        with open(os.path.join(run_dir, name)) as fh:
            return json.load(fh)
    except Exception:
        return None


item = load('item.json') or json.load(open(os.environ['NVB_ITEM_PATH']))
env = load('nyv.json')
truth = load('truth.json') or {}
direct = load('direct.json')

# The SDK envelope is sometimes wrapped in `data`; unwrap without assuming either.
node = env if not isinstance(env, dict) else (env.get('data') if isinstance(env.get('data'), dict) else env)
node = node if isinstance(node, dict) else {}
cost = node.get('cost') if isinstance(node.get('cost'), dict) else {}
tokens = cost.get('tokens') if isinstance(cost.get('tokens'), dict) else {}
wasted = cost.get('wasted') if isinstance(cost.get('wasted'), dict) else {}

content = node.get('content') or ((node.get('curated') or {}) if isinstance(node.get('curated'), dict) else {}).get('summary') or ''
content = str(content)

citations = node.get('citations')
citation_count = len(citations) if isinstance(citations, list) else (1 if isinstance(citations, dict) and citations else 0)

layers = node.get('layersUsed')
if not isinstance(layers, list):
    layers = ((node.get('metadata') or {}) if isinstance(node.get('metadata'), dict) else {}).get('layersUsed')
layers = layers if isinstance(layers, list) else []

meta = node.get('metadata') if isinstance(node.get('metadata'), dict) else {}
orch = node.get('orchestration') if isinstance(node.get('orchestration'), dict) else {}
trust = node.get('trust') if isinstance(node.get('trust'), dict) else {}
qenv = node.get('qualityEnvelope') if isinstance(node.get('qualityEnvelope'), dict) else {}

# Direct baseline: Gemini reports real usage, so no estimation anywhere on this side.
dtext, dusage, derr = '', {}, None
if isinstance(direct, dict):
    try:
        dtext = direct['candidates'][0]['content']['parts'][0]['text']
    except Exception:
        derr = str((direct.get('error') or {}).get('message') or (direct.get('error') or {}).get('status') or '')[:200] or None
        # A response with usage but no text (e.g. MAX_TOKENS with all output as
        # thinking tokens) is still billed — keep the usage, flag the empty text.
        try:
            derr = derr or str(direct['candidates'][0].get('finishReason'))
        except Exception:
            pass
    dusage = direct.get('usageMetadata') or {}

result = {
    'itemId': item.get('id'),
    'classId': item.get('classId'),
    'label': item.get('label'),
    'run': int(os.environ.get('NVB_RUN', '1')),
    'nyv': {
        'http': os.environ['NVB_HTTP'],
        'wallSec': round(float(os.environ['NVB_W1']) - float(os.environ['NVB_W0']), 3),
        'requestId': node.get('requestId'),
        # Envelope CLAIM — our own accounting. Cross-checked against `truth` below.
        'envelopeCompletions': cost.get('completions'),
        'envelopePromptTokens': tokens.get('prompt'),
        'envelopeCompletionTokens': tokens.get('completion'),
        'envelopeTotalTokens': tokens.get('total'),
        'envelopeLatencyMs': cost.get('latencyMs'),
        'envelopeModel': cost.get('model'),
        'envelopeProvider': cost.get('provider'),
        # NV-ZEROCOST-ATTRIBUTION-001 — the STATED mechanism. Absent on a build
        # that predates the field, which the attribution layer reports as an
        # instrument gap rather than treating as 'llm'.
        'envelopeResolution': cost.get('resolution'),
        'envelopeResolutionDetail': cost.get('resolutionDetail'),
        'envelopeLeafCacheHits': cost.get('leafCacheHits'),
        'envelopeCacheSemanticMatch': (orch.get('cacheSemanticMatch') if isinstance(orch, dict) else None),
        'envelopeCacheSimilarityScore': (orch.get('cacheSimilarityScore') if isinstance(orch, dict) else None),
        'path': cost.get('path') or (node.get('routing') or {}).get('path'),
        'wastedCompletions': wasted.get('completions'),
        'wastedPromptTokens': wasted.get('promptTokens'),
        'wastedCompletionTokens': wasted.get('completionTokens'),
        'wastedCostUsd': wasted.get('costUsd'),
        'layersUsed': layers[:24],
        'cacheHitsMeta': meta.get('cacheHits'),
        'cacheHitFlag': node.get('cacheHit'),
        'agentsUsed': node.get('agentsUsed'),
        'orchestrationPattern': node.get('orchestrationPattern'),
        'riskBadge': node.get('riskBadge'),
        'trustQualityOk': trust.get('qualityOk'),
        'trustCitationsPresent': trust.get('citationsPresent'),
        'qualityMissingMandatory': (qenv.get('missingMandatory') if isinstance(qenv.get('missingMandatory'), list) else None),
        'answerChars': len(content),
        'structuredCitationCount': citation_count,
        'envelopeKeys': sorted(node.keys())[:40],
    },
    # GROUND TRUTH — independent of the envelope.
    'truth': {
        k: truth.get(k) for k in (
            'scopeMode', 'billedCompletions', 'billedCompletionsWindow', 'byKind', 'byModel',
            'usageSource', 'tokensInKnown', 'tokensOutKnown', 'costUsdKnown',
            'callsWithTokenDetail', 'callsWithoutTokenDetail',
            'wastedCompletions', 'wastedTokensIn', 'wastedTokensOut', 'wastedCostUsd',
            'hedgeLoserCancelledLines', 'cacheHintLines',
            'resolutionLines', 'resolutionLinesWindow', 'resolutionScopeMode',
            'logLinesParsedJson', 'logLinesUnparsed',
        )
    },
    'truthCalls': [
        {
            'kind': c.get('kind'), 'model': c.get('model'), 'latencyMs': c.get('latencyMs'),
            'tokensIn': c.get('tokensIn'), 'tokensOut': c.get('tokensOut'),
            'costUsd': c.get('costUsd'), 'usageSource': c.get('usageSource'),
            # Kept so a `window`-scoped count can be diagnosed: if these ids are all
            # equal to each other but differ from the envelope's, the two id spaces
            # simply differ; if they differ from EACH OTHER, the window caught
            # another request's traffic and the count is not this request's fan-out.
            'requestId': c.get('requestId'),
        }
        for c in (truth.get('calls') or [])
    ],
    'direct': {
        'http': os.environ['NVB_DHTTP'],
        'model': os.environ['NVB_DIRECT_MODEL'],
        'wallSec': (round(float(os.environ['NVB_D1']) - float(os.environ['NVB_D0']), 3)
                    if os.environ['NVB_D0'] not in ('', '0') else None),
        'promptTokens': dusage.get('promptTokenCount'),
        'completionTokens': dusage.get('candidatesTokenCount'),
        'thoughtsTokens': dusage.get('thoughtsTokenCount'),
        'totalTokens': dusage.get('totalTokenCount'),
        'cachedTokens': dusage.get('cachedContentTokenCount'),
        'answerChars': len(dtext),
        'error': derr,
    },
}

def emit(tag, obj):
    """Emit a payload as indexed fixed-width base64 chunks.

    `aws ssm list-command-invocations --output text` reflows long single lines,
    which silently corrupted a ~1.5 KB base64 blob into an unterminated one. The
    driver could not distinguish that from a host failure. Chunking with an
    explicit `index/total` makes truncation and reordering both detectable.
    """
    blob = base64.b64encode(gzip.compress(json.dumps(obj, separators=(',', ':')).encode())).decode()
    width = 512
    chunks = [blob[i:i + width] for i in range(0, len(blob), width)] or ['']
    for idx, chunk in enumerate(chunks):
        print(f'{tag} {idx} {len(chunks)} {chunk}')


emit('NVBENCH_RESULT_GZB64', result)

# Raw answers travel gzipped+base64 because SSM truncates long plugin output.
# They exist for HUMAN/SME scoring — this harness does not score legal quality.
answers = {
    'itemId': item.get('id'),
    'classId': item.get('classId'),
    'run': int(os.environ.get('NVB_RUN', '1')),
    'prompt': item.get('prompt'),
    'nyvAnswer': content[:12000],
    'nyvAnswerTruncated': len(content) > 12000,
    'directAnswer': dtext[:12000],
    'directAnswerTruncated': len(dtext) > 12000,
}
emit('NVBENCH_ANSWERS_GZB64', answers)
PY

echo "NVBENCH_DONE ${RUN_DIR}"
