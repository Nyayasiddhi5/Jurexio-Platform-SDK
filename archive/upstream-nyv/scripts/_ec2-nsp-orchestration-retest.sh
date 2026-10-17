#!/usr/bin/env bash
# Live NSP orchestration quality re-test on EC2 (NYV-SDK-AUTO-ORCH-001).
set -euo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
BASE="https://api.nyayasiddhi.online"

[[ -f "$CANON" ]] || { echo "ERROR: missing $CANON" >&2; exit 2; }

python3 <<'PY'
import json, os, re, subprocess, urllib.request
from datetime import datetime, timezone

CANON = "/opt/Nyayavigya/secrets/.env.production"
BASE = "https://api.nyayasiddhi.online"
OUT = f"/tmp/nsp-orchestration-retest-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.json"

key = None
for line in open(CANON):
    if line.startswith("NYV_SDK_KEY_NSP="):
        key = line.strip().split("=", 1)[1].strip().strip('"').strip("'")
        break
if not key:
    raise SystemExit("ERROR: NYV_SDK_KEY_NSP not in canonical env")
print(f"NSP key: present ({len(key)} chars)")
print(f"Target: {BASE}\n")

def http_json(method, url, body=None, api_key=None, timeout=300):
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["X-API-Key"] = api_key
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode()
            return resp.status, json.loads(raw) if raw.strip() else {}
    except TimeoutError:
        return 504, {"error": f"client timeout after {timeout}s"}
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            j = json.loads(raw)
        except Exception:
            j = {"error": raw[:500]}
        return e.code, j

def pick_meta(j):
    data = j.get("data") or j
    content = data.get("content") or j.get("content") or ""
    if isinstance(content, dict):
        content = content.get("text") or str(content)
    content = str(content)
    def g(*keys):
        for k in keys:
            if k in data and data[k] is not None: return data[k]
            if k in j and j[k] is not None: return j[k]
        return None
    executions = data.get("executions") or j.get("executions") or []
    return {
        "orchestrationMode": g("orchestrationMode"),
        "autoOrchestrated": g("autoOrchestrated"),
        "agentsUsed": g("agentsUsed"),
        "orchestrationPattern": g("orchestrationPattern", "pattern"),
        "complexityAssessment": g("complexityAssessment"),
        "tier": g("tier"),
        "model": g("model"),
        "provider": g("provider"),
        "agent": g("agent"),
        "citationsVerified": g("citationsVerified"),
        "groundingStatus": g("groundingStatus"),
        "totalTokens": g("totalTokens"),
        "totalTime": g("totalTime"),
        "executionsCount": len(executions),
        "contentLength": len(content),
        "contentPreview": " ".join(content.split())[:280],
        "hasLegalMarkers": bool(re.search(r"§|Section|Act,|Contract Act|precedent|RBI|PMLA", content, re.I)),
        "_content": content,
    }

CASES = [
    ("simple", "Simple single-issue", False, {
        "prompt": "In one sentence under Indian law, what is consideration?",
        "jurisdiction": "IN", "taskType": "summarize", "mode": "sync",
    }),
    ("complex-contract", "Multi-issue contract dispute", True, {
        "prompt": (
            "Our client signed a software licensing agreement with a force majeure clause, "
            "then the vendor terminated for alleged breach of SLA uptime guarantees while "
            "simultaneously invoking limitation of liability and indemnity caps. "
            "Analyze: (1) whether termination was valid under the Indian Contract Act and IT Act, "
            "(2) interplay of force majeure vs frustration, (3) recoverable damages and "
            "injunctive relief, citing applicable sections and leading precedents."
        ),
        "jurisdiction": "IN", "taskType": "analysis", "enableRAG": True, "enableHallucinationCheck": True,
    }),
    ("complex-multi-domain", "Cross-domain regulatory", True, {
        "prompt": (
            "A fintech NBFC is launching cross-border remittance with KYC under PMLA, "
            "RBI master directions, and DPDP Act consent flows. Draft a compliance checklist "
            "covering licensing, data localization, grievance redressal, and agent liability "
            "for AI-assisted customer onboarding."
        ),
        "jurisdiction": "IN", "taskType": "analysis", "enableRAG": True,
    }),
]

_, health = http_json("GET", f"{BASE}/api/jrx/health")
results = []
for cid, label, expect_queen, body in CASES:
    import time
    t0 = time.time()
    status, j = http_json("POST", f"{BASE}/api/jrx/orchestrate", body, api_key=key)
    elapsed = int((time.time() - t0) * 1000)
    meta = pick_meta(j)
    auto = meta.get("autoOrchestrated")
    agents = meta.get("agentsUsed")
    queen = bool(auto is True or (isinstance(agents, int) and agents > 1) or meta.get("executionsCount", 0) > 1)
    passed = status == 200 and meta["contentLength"] > 50 and (queen if expect_queen else True)
    # strip full content from saved meta
    meta_out = {k: v for k, v in meta.items() if k != "_content"}
    r = {
        "id": cid, "label": label, "expectQueen": expect_queen,
        "httpStatus": status, "elapsedMs": elapsed, "queenEngaged": queen, "pass": passed,
        "meta": meta_out, "error": j.get("error"),
    }
    results.append(r)
    print(f"CASE {cid}: {label}")
    print(f"  HTTP {status} | {elapsed}ms | queen={queen} | autoOrch={auto} | agents={agents} | "
          f"pattern={meta.get('orchestrationPattern')} | tier={meta.get('tier')} | model={meta.get('model')} | "
          f"len={meta['contentLength']} | pass={passed}")
    if meta.get("complexityAssessment"):
        print(f"  complexity={json.dumps(meta['complexityAssessment'])}")
    if status != 200:
        print(f"  error={j.get('error') or j.get('message')}")
    print(f"  preview={meta['contentPreview'][:200]}...\n")

all_pass = all(r["pass"] for r in results)
any_200 = any(r["httpStatus"] == 200 for r in results)
verdict = "PASS" if all_pass else ("PARTIAL" if any_200 else "FAIL")
summary = {
    "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    "base": BASE,
    "healthVersion": health.get("version"),
    "registryVersion": health.get("registryVersion"),
    "totalAgents": health.get("totalAgents"),
    "fix": "NYV-SDK-AUTO-ORCH-001 (fa5155072, b4ab13476, 856c74737)",
    "beforeAfterNote": (
        "Before fix: partner /orchestrate without orchestrationMode fell to single-shot ring at tier default "
        "(cheap model, no Queen, stripped envelope). After fix: complex prompts auto-engage Queen with full metadata."
    ),
    "results": results,
    "verdict": verdict,
}
open(OUT, "w").write(json.dumps(summary, indent=2))
print(f"Wrote {OUT}")
print(f"VERDICT: {verdict} ({sum(1 for r in results if r['pass'])}/{len(results)} cases pass)")
print(json.dumps(summary, indent=2))
PY
