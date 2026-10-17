#!/usr/bin/env bash
# NSP stream crosscheck — 3 modes for SSE run_completed contract. NV-SECRETS-001.
set -uo pipefail
python3 <<'PY'
import json, time, urllib.request, urllib.error, uuid

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

print("=== DEPLOY ===")
for label, path in [("CURRENT", "/opt/nyayavigya/CURRENT_DEPLOY"), ("LAST_GOOD", "/opt/nyayavigya/LAST_GOOD_DEPLOY")]:
    try:
        print(f"{label}={open(path).read().strip()}")
    except OSError:
        print(f"{label}=missing")

headers = {
    "Content-Type": "application/json",
    "X-API-Key": key,
    "X-NYV-Platform": "nsp",
}

def stream_probe(label, body_dict, timeout=120):
    body = json.dumps(body_dict).encode()
    req = urllib.request.Request(f"{BASE}/api/jrx/orchestrate/stream", data=body, headers=headers, method="POST")
    t0 = time.time()
    try:
        resp = urllib.request.urlopen(req, timeout=timeout)
    except urllib.error.HTTPError as e:
        ms = int((time.time() - t0) * 1000)
        print(f"STREAM {label} http={e.code} ms={ms} delta_events=0 err=HTTPError")
        return {"label": label, "http": e.code, "pass": False}
    code = resp.status
    buf = ""
    delta_count = 0
    run_completed = None
    has_text_delta = False
    while True:
        chunk = resp.read(4096)
        if not chunk:
            break
        buf += chunk.decode(errors="replace")
        while "\n\n" in buf:
            block, buf = buf.split("\n\n", 1)
            if '"type": "text_delta"' in block or '"type":"text_delta"' in block:
                delta_count += 1
                has_text_delta = True
            if '"type": "run_completed"' in block or '"type":"run_completed"' in block:
                for line in block.split("\n"):
                    if line.startswith("data: "):
                        evt = json.loads(line[6:])
                        run_completed = evt.get("result") or {}
    ms = int((time.time() - t0) * 1000)
    rc = run_completed or {}
    dq = rc.get("draftQuality") or {}
    qe = rc.get("qualityEnvelope")
    keys = sorted(rc.keys()) if isinstance(rc, dict) else []
    checks = {
        "text_delta": has_text_delta,
        "run_completed": run_completed is not None,
        "content": bool(str(rc.get("result") or rc.get("content") or "").strip()),
        "qualityEnvelope": qe is not None,
        "riskBadge": rc.get("riskBadge") is not None,
        "auditHash": bool(rc.get("auditHash")),
        "draftQuality": isinstance(dq, dict) and len(dq) > 0,
        "validationResults": isinstance(rc.get("validationResults"), list) and len(rc.get("validationResults") or []) > 0,
        "draftProfile": isinstance(rc.get("draftProfile"), dict),
        "structureMarkers": isinstance(dq.get("structureMarkers"), dict),
        "inferredDocumentType": dq.get("inferredDocumentType") is not None,
        "routing_hint": rc.get("routing_hint") is not None or dq.get("routingHint") is not None,
    }
    mode_pass = all(checks[k] for k in checks if k not in ("inferredDocumentType", "routing_hint"))
    print(
        f"STREAM {label} http={code} ms={ms} delta_events={delta_count} "
        f"run_completed_keys={keys[:20]}{'...' if len(keys)>20 else ''} "
        f"draftQuality_keys={sorted(dq.keys()) if dq else None} "
        f"inferredDocumentType={dq.get('inferredDocumentType')} "
        f"routing_hint={rc.get('routing_hint') or dq.get('routingHint')} "
        f"riskBadge={rc.get('riskBadge')} auditHash_len={len(str(rc.get('auditHash') or ''))}"
    )
    print(f"CHECKS {label} {json.dumps(checks)} pass_core={mode_pass}")
    return {"label": label, "http": code, "checks": checks, "pass_core": mode_pass}

stamp = uuid.uuid4().hex[:8]

cases = [
    ("fast_chat", {
        "prompt": f"What are twin conditions for anticipatory bail under BNSS? ref {stamp}",
        "taskType": "legal-chat-fast",
        "jurisdiction": "IN",
        "maxTokens": 512,
    }),
    ("fast_draft_low", {
        "prompt": f"Draft anticipatory bail prayer ref {stamp}",
        "taskType": "legal-draft-fast",
        "jurisdiction": "IN",
        "options": {"draftLength": "low"},
        "maxTokens": 1024,
    }),
    ("standard_draft_notice", {
        "prompt": f"Draft legal notice for cheque dishonour Rs 5 lakh ref {stamp}",
        "taskType": "legal-draft-fast",
        "jurisdiction": "IN",
        "parameters": {"documentType": "legal_notice"},
        "options": {"draftLength": "medium"},
        "maxTokens": 2048,
    }),
]

print("=== NSP STREAM CROSSCHECK ===")
results = []
for label, body in cases:
    results.append(stream_probe(label, body))

print("=== MATRIX ===")
for r in results:
    c = r.get("checks") or {}
    print(f"{r['label']}: http={r['http']} core_pass={r.get('pass_core')} inferred={c.get('inferredDocumentType')} routing_hint={c.get('routing_hint')}")
PY
