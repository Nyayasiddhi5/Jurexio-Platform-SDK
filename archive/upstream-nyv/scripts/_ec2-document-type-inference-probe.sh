#!/usr/bin/env bash
# NV-DOCUMENT-TYPE-INFERENCE-001 — verify missing/unknown/explicit documentType on draft paths.
# Runs ON nysdev EC2. NV-SECRETS-001: never echo secret values.
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

def sync_draft(label, body_dict, timeout=90):
    body = json.dumps(body_dict).encode()
    req = urllib.request.Request(f"{BASE}/api/jrx/orchestrate", data=body, headers=headers, method="POST")
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            code = resp.status
            raw = resp.read()
    except urllib.error.HTTPError as e:
        code = e.code
        raw = e.read()
    ms = int((time.time() - t0) * 1000)
    try:
        d = json.loads(raw)
    except Exception:
        d = {}
    data = d.get("data") or d
    dq = data.get("draftQuality") or {}
    err = d.get("error") or {}
    content_len = len(str(data.get("content") or ""))
    print(
        f"SYNC {label} http={code} ms={ms} success={d.get('success')} "
        f"inferredDocumentType={dq.get('inferredDocumentType')} "
        f"documentTypeSource={dq.get('documentTypeSource')} "
        f"partnerDocumentTypeRaw={dq.get('partnerDocumentTypeRaw')} "
        f"content_len={content_len} err_code={err.get('code')}"
    )
    return code

def stream_draft(label, body_dict, timeout=120):
    body = json.dumps(body_dict).encode()
    req = urllib.request.Request(f"{BASE}/api/jrx/orchestrate/stream", data=body, headers=headers, method="POST")
    t0 = time.time()
    try:
        resp = urllib.request.urlopen(req, timeout=timeout)
    except urllib.error.HTTPError as e:
        ms = int((time.time() - t0) * 1000)
        print(f"STREAM {label} http={e.code} ms={ms} delta_events=0 err=HTTPError")
        return e.code
    code = resp.status
    buf = ""
    delta_count = 0
    draft_quality = None
    while True:
        chunk = resp.read(4096)
        if not chunk:
            break
        buf += chunk.decode(errors="replace")
        while "\n\n" in buf:
            block, buf = buf.split("\n\n", 1)
            if '"type": "text_delta"' in block or '"type":"text_delta"' in block:
                delta_count += 1
            if '"type": "run_completed"' in block or '"type":"run_completed"' in block:
                for line in block.split("\n"):
                    if line.startswith("data: "):
                        evt = json.loads(line[6:])
                        res = evt.get("result") or {}
                        draft_quality = res.get("draftQuality")
    ms = int((time.time() - t0) * 1000)
    dq = draft_quality or {}
    print(
        f"STREAM {label} http={code} ms={ms} delta_events={delta_count} "
        f"inferredDocumentType={dq.get('inferredDocumentType')} "
        f"documentTypeSource={dq.get('documentTypeSource')} "
        f"partnerDocumentTypeRaw={dq.get('partnerDocumentTypeRaw')}"
    )
    return code

stamp = uuid.uuid4().hex[:8]

# 1) Missing documentType — vague prompt → general fallback or inference
missing_body = {
    "prompt": f"Prepare a legal document for my client ref {stamp}",
    "taskType": "legal-draft-fast",
    "jurisdiction": "IN",
    "maxTokens": 256,
}

# 2) Unknown explicit documentType → general_legal_document fallback
unknown_body = {
    "prompt": f"Draft document ref {stamp}",
    "taskType": "legal-draft-fast",
    "jurisdiction": "IN",
    "parameters": {"documentType": "custom_partner_slug_xyz"},
    "maxTokens": 256,
}

# 3) Known documentType regression
known_body = {
    "prompt": f"Draft legal notice for cheque dishonour Rs 5 lakh ref {stamp}",
    "taskType": "legal-draft-fast",
    "jurisdiction": "IN",
    "parameters": {"documentType": "legal_notice"},
    "maxTokens": 256,
}

# 4) Missing with inferrable prompt (bail)
infer_body = {
    "prompt": f"Draft anticipatory bail under BNS for Sessions Court ref {stamp}",
    "taskType": "legal-draft-fast",
    "jurisdiction": "IN",
    "maxTokens": 256,
}

print("=== DOCUMENT TYPE INFERENCE PROBES ===")
c1 = sync_draft("missing_vague", missing_body)
c2 = sync_draft("unknown_explicit", unknown_body)
c3 = sync_draft("known_legal_notice", known_body)
c4 = sync_draft("missing_infer_bail", infer_body)
c5 = stream_draft("stream_missing_vague", missing_body)

print("=== SUMMARY ===")
results = {
    "missing_vague_sync": c1,
    "unknown_explicit_sync": c2,
    "known_legal_notice_sync": c3,
    "missing_infer_bail_sync": c4,
    "stream_missing_vague": c5,
}
all_200 = all(v == 200 for v in results.values())
print(f"all_http_200={all_200} results={json.dumps(results)}")
PY
