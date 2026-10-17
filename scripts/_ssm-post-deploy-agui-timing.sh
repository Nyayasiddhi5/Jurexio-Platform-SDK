#!/usr/bin/env bash
set -euo pipefail
# Post-deploy AG-UI stream timing probe (runs on EC2 with gateway env).
source /opt/nyayavigya/repo/CURRENT_DEPLOY/.env 2>/dev/null || source /opt/nyayavigya/.env 2>/dev/null || true
KEY="${JRX_SDK_KEY_NSP:-}"
API="http://127.0.0.1:5000"
PROMPT="What is Section 103 of the Bharatiya Nyaya Sanhita about?"
TMP=$(mktemp)
START=$(date +%s%3N)
curl -sS -N --max-time 300 \
  -H "Authorization: Bearer ${KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"task\":\"${PROMPT}\",\"pattern\":\"P11\",\"jurisdiction\":\"IN\"}" \
  "${API}/api/jrx/stream" > "$TMP" || true
python3 - "$TMP" "$START" <<'PY'
import json, sys, time
path, start = sys.argv[1], int(sys.argv[2])
raw = open(path, encoding='utf-8', errors='replace').read()
rows = []
prev = start
for chunk in [c.strip() for c in raw.split('\n\n') if c.strip()]:
    line = next((l for l in chunk.split('\n') if l.startswith('data: ')), None)
    if not line: continue
    payload = line[6:].strip()
    if payload == '[DONE]': continue
    try: evt = json.loads(payload)
    except: continue
    now = int(time.time() * 1000)
    etype = evt.get('type', '?')
    step = evt.get('step') or evt.get('subtype') or evt.get('name') or ''
    rows.append((now - prev, etype, step))
    prev = now
print(f"events={len(rows)} wall_ms={prev-start}")
print(f"{'delta_ms':>8}  {'type':<16}  step/subtype")
for d,t,s in rows:
    if t in ('timeline_step','run_started','pattern_event','tool_call','tool_result','run_completed') or s:
        print(f"{d:8d}  {t:<16}  {s}")
PY
rm -f "$TMP"
