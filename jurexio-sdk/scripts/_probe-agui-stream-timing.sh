#!/usr/bin/env bash
# Probe POST /api/jrx/stream SSE — per-event latency table (no secrets echoed).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck disable=SC1091
source .env 2>/dev/null || true

API_BASE="${NV_API_BASE:-https://api.jurexio.com}"
SDK_KEY="${JRX_SDK_KEY_NSP:-${NV_API_KEY:-}}"
PROMPT="${1:-What is Section 103 of the Bharatiya Nyaya Sanhita about?}"

if [[ -z "$SDK_KEY" ]]; then
  echo "missing SDK key (JRX_SDK_KEY_NSP or NV_API_KEY)" >&2
  exit 1
fi

TMP=$(mktemp)
START_MS=$(python3 - <<'PY'
import time; print(int(time.time()*1000))
PY
)

curl -sS -N --max-time 360 \
  -H "Authorization: Bearer ${SDK_KEY}" \
  -H "Content-Type: application/json" \
  -H "X-JRX-SDK-Key: ${SDK_KEY}" \
  -d "{\"task\":$(python3 -c "import json,sys; print(json.dumps(sys.argv[1]))" "$PROMPT"),\"pattern\":\"P11\",\"jurisdiction\":\"IN\",\"includeThinking\":false,\"includeCitations\":true}" \
  "${API_BASE}/api/jrx/stream" > "$TMP" || true

python3 - "$TMP" "$START_MS" <<'PY'
import json, sys, re
path, start_ms = sys.argv[1], int(sys.argv[2])
raw = open(path, encoding='utf-8', errors='replace').read()
chunks = [c.strip() for c in raw.split('\n\n') if c.strip()]
rows = []
prev = start_ms
for chunk in chunks:
    data_line = next((l for l in chunk.split('\n') if l.startswith('data: ')), None)
    if not data_line:
        continue
    payload = data_line[6:].strip()
    if payload == '[DONE]':
        continue
    try:
        evt = json.loads(payload)
    except json.JSONDecodeError:
        continue
    now = int(__import__('time').time() * 1000)
    etype = evt.get('type') or evt.get('event') or '?'
    step = evt.get('step') or evt.get('subtype') or evt.get('name') or ''
    delta = now - prev
    prev = now
    rows.append((delta, etype, step, evt.get('status', '')))

print(f"events={len(rows)} wall_ms={prev-start_ms}")
print(f"{'delta_ms':>8}  {'type':<18}  {'step/subtype':<28}  status")
for d, t, s, st in rows:
    print(f"{d:8d}  {t:<18}  {s:<28}  {st}")
PY

rm -f "$TMP"
