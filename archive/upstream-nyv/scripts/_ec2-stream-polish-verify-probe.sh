#!/usr/bin/env bash
# NV-STREAM-TERMINAL-POLISH-001 — verify draftQuality + gated delta on stream.
set -uo pipefail
python3 <<'PY'
import json, time, urllib.request, uuid

CANON = "/opt/Nyayavigya/secrets/.env.production"
BASE = "https://api.nyayasiddhi.online"

def load_key(name):
    pref = f"{name}="
    for line in open(CANON):
        if line.startswith(pref):
            return line.strip().split("=", 1)[1].strip().strip('"').strip("'")
    return None

key = load_key("NYV_SDK_KEY_NSP")
if not key or len(key) < 16:
    print("PROBE BROKEN: no NSP key")
    raise SystemExit(3)

stamp = uuid.uuid4().hex[:8]
body = json.dumps({
    "prompt": f"Draft bail prayer under BNSS with MOST RESPECTFULLY SHOWETH section ref {stamp}",
    "taskType": "legal-draft-fast",
    "jurisdiction": "IN",
    "maxTokens": 512,
}).encode()
headers = {
    "Content-Type": "application/json",
    "X-API-Key": key,
    "X-NYV-Platform": "nsp",
}
req = urllib.request.Request(f"{BASE}/api/jrx/orchestrate/stream", data=body, headers=headers, method="POST")
t0 = time.time()
first_delta_ms = None
delta_count = 0
gated_count = 0
terminal_polish = False
draft_quality = None
curated_sections = None
showeth = False

with urllib.request.urlopen(req, timeout=180) as resp:
    buf = ""
    while True:
        chunk = resp.read(4096)
        if not chunk:
            break
        buf += chunk.decode(errors="replace")
        while "\n\n" in buf:
            block, buf = buf.split("\n\n", 1)
            if "text_delta" in block and first_delta_ms is None:
                first_delta_ms = int((time.time() - t0) * 1000)
            if '"type": "text_delta"' in block or '"type":"text_delta"' in block:
                delta_count += 1
                if "stream.terminal_polish" in block:
                    terminal_polish = True
                if '"gated": true' in block or '"gated":true' in block:
                    gated_count += 1
            if '"type": "run_completed"' in block or '"type":"run_completed"' in block:
                for line in block.split("\n"):
                    if line.startswith("data: "):
                        evt = json.loads(line[6:])
                        res = evt.get("result") or {}
                        draft_quality = res.get("draftQuality")
                        curated = res.get("curated") or {}
                        curated_sections = len(curated.get("sections") or [])
                        text = str(res.get("result") or res.get("content") or "")
                        showeth = "**MOST RESPECTFULLY SHOWETH:**" in text

print(json.dumps({
    "first_delta_ms": first_delta_ms,
    "delta_events": delta_count,
    "gated_deltas": gated_count,
    "terminal_polish_delta": terminal_polish,
    "draftQuality_keys": sorted(list(draft_quality.keys())) if isinstance(draft_quality, dict) else None,
    "curated_sections": curated_sections,
    "showeth_normalized": showeth,
}, indent=2))
PY
