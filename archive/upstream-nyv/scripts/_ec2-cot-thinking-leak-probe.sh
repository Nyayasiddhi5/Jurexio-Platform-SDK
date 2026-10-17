#!/usr/bin/env bash
# NV-COT-THINKING-LEAK-PROBE — live NSP/NYM orchestrate response shape audit.
# Runs ON nysdev EC2. Keys from canonical env only. Never echo secret values.
set -uo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
API="https://api.nyayasiddhi.online"

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

LEAK_PATTERNS = [
    (r"<thinking>", "xml_thinking_open"),
    (r"</thinking>", "xml_thinking_close"),
    (r"Let me think", "let_me_think"),
    (r"Orchestrated Response", "orch_header"),
    (r"Failed Branches", "failed_branches"),
    (r"RETRIEVAL POLICY", "retrieval_policy"),
    (r"swarm-agent-", "swarm_agent"),
    (r"Queen Orchestration Engine", "queen_engine"),
    (r"per-node timeout", "per_node_timeout"),
    (r'"agentId"', "agent_json_envelope"),
    (r'"patternUsed"', "pattern_used_json"),
    (r"I need to (analyze|consider|think)", "internal_monologue"),
]

def http_json(body, api_key, platform, timeout=120):
    headers = {
        "Content-Type": "application/json",
        "X-API-Key": api_key,
        "X-NYV-Platform": platform,
    }
    data = json.dumps(body).encode()
    req = urllib.request.Request(f"{BASE}/api/jrx/orchestrate", data=data, headers=headers, method="POST")
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode()
            return resp.status, json.loads(raw), int((time.time() - t0) * 1000)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            j = json.loads(raw)
        except Exception:
            j = {"error": raw[:300]}
        return e.code, j, int((time.time() - t0) * 1000)

def scan_text(text):
    hits = []
    for pat, name in LEAK_PATTERNS:
        if re.search(pat, text, re.I):
            hits.append(name)
    return hits

def analyze(platform, key, task, prompt):
    body = {"prompt": prompt, "taskType": task, "jurisdiction": "IN", "maxTokens": 256}
    status, j, ms = http_json(body, key, platform.lower())
    data = j.get("data") or j
    content = str(data.get("content") or data.get("answer") or "")
    curated = data.get("curated") or {}
    summary = str(curated.get("summary") or "")
    top_keys = sorted(data.keys())
    partner_safe = {
        "content", "curated", "citations", "cost", "routing", "trust",
        "riskBadge", "auditHash", "requestId", "grounding", "qualityEnvelope",
        "sessionId", "requestPhase", "hallucinationCheck", "compliancePassed",
        "safetyVerdict", "tier", "optionalDegraded", "orchestrationId",
    }
    meta_keys = [k for k in top_keys if k not in partner_safe]
    content_hits = scan_text(content)
    summary_hits = scan_text(summary)
    cot = data.get("chainOfThought")
    qe = data.get("qualityEnvelope")

    print(f"\n=== {platform} {task} http={status} ms={ms} success={j.get('success')} ===")
    print(f"routing.path={(data.get('routing') or {}).get('path')} content_len={len(content)} summary_len={len(summary)}")
    print(f"top_keys={top_keys}")
    print(f"non_contract_meta_keys={meta_keys}")
    print(f"chainOfThought={'present' if cot else 'absent'}")
    if cot and isinstance(cot, dict):
        steps = cot.get("steps") or []
        print(f"  cot.steps={len(steps)} strategy={cot.get('strategy')}")
    print(f"qualityEnvelope={'present' if qe else 'absent'}")
    print(f"content_leaks={content_hits or 'NONE'}")
    print(f"summary_leaks={summary_hits or 'NONE'}")
    print(f"content_preview={' '.join(content.split())[:240]}")
    if data.get("executions"):
        print("WARN: executions still in payload")
    if data.get("taskDecomposition"):
        print("WARN: taskDecomposition still in payload")
    return {
        "platform": platform,
        "task": task,
        "content_hits": content_hits,
        "summary_hits": summary_hits,
        "has_cot": bool(cot),
        "has_qe": bool(qe),
        "meta_keys": meta_keys,
    }

results = []
for plat, keyname in [("NSP", "NYV_SDK_KEY_NSP"), ("NYM", "NYV_SDK_KEY_NYM")]:
    key = load_key(keyname)
    if not key or len(key) < 16:
        print(f"SKIP {plat}: no key")
        continue
    for task, prompt in [
        ("legal-chat-fast", "What is anticipatory bail under BNSS? One paragraph."),
        ("legal-draft-fast", "Draft one sentence bail application prayer."),
    ]:
        results.append(analyze(plat, key, task, prompt))

any_content_leak = any(r["content_hits"] for r in results)
any_summary_leak = any(r["summary_hits"] for r in results)
print(
    f"\n=== VERDICT content_leaks={any_content_leak} summary_leaks={any_summary_leak} "
    f"cot_in_payload={any(r['has_cot'] for r in results)} "
    f"qe_in_payload={any(r['has_qe'] for r in results)} ==="
)
PY
