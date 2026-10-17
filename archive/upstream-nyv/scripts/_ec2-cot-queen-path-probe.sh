#!/usr/bin/env bash
# Queen + CoT path probe — longer timeout, checks orchestration nested object.
set -uo pipefail
python3 <<'PY'
import json, re, urllib.request, urllib.error, time

CANON = "/opt/Nyayavigya/secrets/.env.production"
BASE = "https://api.nyayasiddhi.online"

def load_key(name):
    pref = f"{name}="
    for line in open(CANON):
        if line.startswith(pref):
            return line.strip().split("=", 1)[1].strip().strip('"').strip("'")
    return None

LEAK = [
    (r"<thinking>", "xml_thinking"),
    (r"Orchestrated Response", "orch_header"),
    (r"Failed Branches", "failed_branches"),
    (r"Let me think", "let_me_think"),
    (r"swarm-agent-", "swarm"),
]

def post(body, key, plat, timeout=300):
    headers = {"Content-Type": "application/json", "X-API-Key": key, "X-NYV-Platform": plat}
    req = urllib.request.Request(f"{BASE}/api/jrx/orchestrate", json.dumps(body).encode(), headers, method="POST")
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read()), int((time.time()-t0)*1000)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try: j = json.loads(raw)
        except: j = {"error": raw[:400]}
        return e.code, j, int((time.time()-t0)*1000)

def hits(text):
    return [n for p,n in LEAK if re.search(p, text, re.I)]

key = load_key("NYV_SDK_KEY_NSP")
cases = [
    ("legal-chat-cot", {"prompt": "Briefly: anticipatory bail BNSS?", "taskType": "legal-chat", "jurisdiction": "IN", "maxTokens": 256, "enableCoT": True}),
    ("legal-draft-cot", {"prompt": "One sentence bail prayer.", "taskType": "legal-draft", "jurisdiction": "IN", "maxTokens": 256, "enableCoT": True}),
]
for label, body in cases:
    st, j, ms = post(body, key, "nsp", 540)
    d = j.get("data") or j
    c = str(d.get("content") or "")
    orch = d.get("orchestration")
    cot = d.get("chainOfThought")
    qe = d.get("qualityEnvelope")
    print(f"\n=== {label} http={st} ms={ms} path={(d.get('routing') or {}).get('path')} ===")
    print(f"content_len={len(c)} content_leaks={hits(c) or 'NONE'}")
    print(f"chainOfThought={'present steps='+str(len((cot or {}).get('steps') or [])) if isinstance(cot,dict) else 'absent'}")
    print(f"qualityEnvelope={'present keys='+str(list((qe or {}).keys())[:8]) if isinstance(qe,dict) else 'absent'}")
    if isinstance(orch, dict):
        print(f"orchestration.keys={sorted(orch.keys())}")
        cot2 = orch.get("chainOfThought")
        if cot2: print(f"  orchestration.chainOfThought present steps={len((cot2 or {}).get('steps') or []) if isinstance(cot2,dict) else 'obj'}")
    print(f"preview={' '.join(c.split())[:200]}")
PY
