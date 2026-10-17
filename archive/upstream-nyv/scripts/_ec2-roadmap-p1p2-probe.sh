#!/usr/bin/env bash
# NV-ROADMAP-P1P2-001 post-deploy probe — runs ON nysdev EC2. Keys from canonical env only.
# NV-SECRETS-001: never echo secret values.
set -uo pipefail

python3 <<'PY'
import json, re, time, urllib.request, uuid

CANON = "/opt/Nyayavigya/secrets/.env.production"
BASE = "https://api.nyayasiddhi.online"
FAILURES = 0

def load_key(name):
    pref = f"{name}="
    for line in open(CANON):
        if line.startswith(pref):
            return line.strip().split("=", 1)[1].strip().strip('"').strip("'")
    return None

def headers(key):
    return {
        "Content-Type": "application/json",
        "X-API-Key": key,
        "X-NYV-Platform": "nsp",
    }

def pass_msg(label, detail=""):
    print(f"PASS {label}" + (f" — {detail}" if detail else ""))

def fail_msg(label, detail=""):
    global FAILURES
    FAILURES += 1
    print(f"FAIL {label}" + (f" — {detail}" if detail else ""))

key = load_key("NYV_SDK_KEY_NSP")
if not key or len(key) < 16:
    print("PROBE BROKEN: no NSP key in canonical env")
    raise SystemExit(3)

print("=== DEPLOY LENS ===")
try:
    current = open("/opt/nyayavigya/CURRENT_DEPLOY").read().strip()
    print(f"CURRENT_DEPLOY={current}")
except Exception:
    print("CURRENT_DEPLOY=missing")
import glob, os, subprocess
repos = sorted(glob.glob("/opt/Nyayavigya/repo/*"), reverse=True)
for live in repos:
    if os.path.isdir(os.path.join(live, "src")):
        print(f"LIVE_REPO={live}")
        try:
            sha = subprocess.check_output(["git", "-C", live, "rev-parse", "--short", "HEAD"], text=True, stderr=subprocess.DEVNULL).strip()
            print(f"GIT_SHA={sha}")
        except Exception:
            print("GIT_SHA=unknown (extracted deploy, no .git)")
        break

print("\n=== PROBE 1: Citation verify (stretch cite) ===")
stretch_prompt = (
    "Draft one paragraph for a quashing petition. State that in Ajay Malik v. State of Uttarakhand "
    "the Court applied Bhajan Lal categories for omnibus FIR quashing."
)
body = json.dumps({
    "prompt": stretch_prompt,
    "taskType": "legal-draft-fast",
    "jurisdiction": "IN",
    "parameters": {"documentType": "bail_application"},
    "options": {"draftLength": "medium"},
    "maxTokens": 512,
}).encode()
req = urllib.request.Request(f"{BASE}/api/jrx/orchestrate", data=body, headers=headers(key), method="POST")
t0 = time.time()
with urllib.request.urlopen(req, timeout=120) as resp:
    j = json.loads(resp.read().decode())
ms = int((time.time() - t0) * 1000)
data = j.get("data") or j
content = str(data.get("content") or "")
dq = data.get("draftQuality") or {}
cite_verified = dq.get("citationVerified")
has_marker = "[CITATION REQUIRED" in content or "CITATION REQUIRED — verify holding" in content
print(f"http={resp.status} ms={ms} citationVerified={cite_verified} marker={has_marker} content_len={len(content)}")
if cite_verified is False or has_marker:
    pass_msg("citation-verify-stretch", f"citationVerified={cite_verified} marker={has_marker}")
else:
    fail_msg("citation-verify-stretch", f"citationVerified={cite_verified} marker={has_marker}")

print("\n=== PROBE 2: legal-chat-fast IPC — SOURCES CONSULTED ===")
chat_uid = uuid.uuid4().hex[:8]
chat_body = json.dumps({
    "prompt": f"What is the punishment under IPC Section 302 for murder in India? uid={chat_uid}",
    "taskType": "legal-chat-fast",
    "jurisdiction": "IN",
    "maxTokens": 512,
    "enableMemory": True,
}).encode()
req2 = urllib.request.Request(f"{BASE}/api/jrx/orchestrate", data=chat_body, headers=headers(key), method="POST")
t0 = time.time()
with urllib.request.urlopen(req2, timeout=120) as resp2:
    j2 = json.loads(resp2.read().decode())
ms2 = int((time.time() - t0) * 1000)
data2 = j2.get("data") or j2
content2 = str(data2.get("content") or "")
orch2 = data2.get("orchestration") or {}
det2 = orch2.get("deterministic")
has_sources = "SOURCES CONSULTED" in content2.upper() or "Sources Consulted" in content2
cache_hit = orch2.get("cacheHit")
print(f"http={resp2.status} ms={ms2} cacheHit={cache_hit} deterministic={det2} sources_block={has_sources} content_len={len(content2)}")
print(f"preview={content2[:160].replace(chr(10), ' ')}")
if has_sources:
    pass_msg("chat-sources-consulted", f"ms={ms2} deterministic={det2}")
else:
    fail_msg("chat-sources-consulted", f"SOURCES CONSULTED missing ms={ms2} deterministic={det2}")

print("\n=== PROBE 3: Stream bail medium — pipeline_ready + text_delta TTFB ===")
stamp = uuid.uuid4().hex[:8]
stream_body = json.dumps({
    "prompt": f"Draft anticipatory bail application under BNSS for wrongful FIR. Ref {stamp}",
    "taskType": "legal-draft-fast",
    "jurisdiction": "IN",
    "parameters": {"documentType": "bail_application"},
    "options": {"draftLength": "medium"},
    "maxTokens": 1024,
}).encode()
req3 = urllib.request.Request(f"{BASE}/api/jrx/orchestrate/stream", data=stream_body, headers=headers(key), method="POST")
t_start = time.time()
pipeline_ready_ms = None
first_delta_ms = None
delta_after_ready_ms = None
events = []
with urllib.request.urlopen(req3, timeout=180) as resp3:
    buf = b""
    while True:
        chunk = resp3.read(4096)
        if not chunk:
            break
        buf += chunk
        while b"\n" in buf:
            line, buf = buf.split(b"\n", 1)
            line = line.strip()
            if not line or line == b"data: [DONE]":
                continue
            if line.startswith(b"data:"):
                line = line[5:].strip()
            try:
                ev = json.loads(line.decode())
            except Exception:
                continue
            et = ev.get("type") or ev.get("event")
            now_ms = int((time.time() - t_start) * 1000)
            events.append(et)
            if et == "pipeline_ready" and pipeline_ready_ms is None:
                pipeline_ready_ms = now_ms
            if et == "text_delta" and first_delta_ms is None:
                first_delta_ms = now_ms
                if pipeline_ready_ms is not None:
                    delta_after_ready_ms = first_delta_ms - pipeline_ready_ms

print(f"pipeline_ready_ms={pipeline_ready_ms} first_text_delta_ms={first_delta_ms} delta_after_ready_ms={delta_after_ready_ms}")
print(f"event_types_sample={events[:12]}")
if pipeline_ready_ms is not None and first_delta_ms is not None:
    pass_msg("stream-pipeline-ready", f"pipeline_ready={pipeline_ready_ms}ms first_delta={first_delta_ms}ms gap={delta_after_ready_ms}ms")
else:
    fail_msg("stream-pipeline-ready", f"pipeline_ready={pipeline_ready_ms} first_delta={first_delta_ms}")

print(f"\n=== SUMMARY failures={FAILURES} ===")
raise SystemExit(1 if FAILURES else 0)
PY
