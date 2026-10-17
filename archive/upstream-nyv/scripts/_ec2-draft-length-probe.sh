#!/usr/bin/env bash
# NV-DRAFT-LENGTH-PROBE — measure legal-draft-fast vs legal-draft content length.
# Keys from canonical env only. Never echo secret values.
set -uo pipefail

python3 <<'PY'
import json, time, urllib.request, urllib.error, uuid, re

CANON = "/opt/Nyayavigya/secrets/.env.production"
BASE = "https://api.nyayasiddhi.online"

BAIL_PROMPT = """Draft a complete bail application under BNSS for anticipatory bail before the Sessions Court, Delhi.

Facts:
- Applicant: Rajesh Kumar, aged 34, resident of Dwarka, Delhi
- FIR No. 245/2025 dated 15-Aug-2025, PS Dwarka South, offences under Sections 420, 468, 471 IPC
- Applicant apprehends arrest; co-accused already in custody; applicant is sole breadwinner
- Applicant undertakes to cooperate with investigation; no flight risk; roots in community

Include: title, court heading, parties, synopsis, grounds (personal liberty, no custodial interrogation needed, parity with co-accused, no tampering), prayer, verification, and list of documents."""

SLP_PROMPT = """Draft skeleton of Special Leave Petition under Article 136 before the Supreme Court of India.

Background: High Court dismissed writ petition challenging termination from government service.
Include: cause title, index, synopsis, questions of law, impugned order details, grounds, interim prayer, main prayer, affidavit paragraph."""

def load_key(name):
    pref = f"{name}="
    for line in open(CANON):
        if line.startswith(pref):
            return line.strip().split("=", 1)[1].strip().strip('"').strip("'")
    return None

def orchestrate(api_key, task, prompt, max_tokens=None, timeout=180, body_extra=None):
    body = {
        "prompt": prompt,
        "taskType": task,
        "jurisdiction": "IN",
    }
    if body_extra:
        body.update(body_extra)
    if max_tokens is not None:
        body["maxTokens"] = max_tokens
    headers = {
        "Content-Type": "application/json",
        "X-API-Key": api_key,
        "X-NYV-Platform": "nsp",
    }
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        f"{BASE}/api/jrx/orchestrate", data=data, headers=headers, method="POST"
    )
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
    except Exception as e:
        return 0, {"success": False, "error": str(e)[:200]}, int((time.time() - t0) * 1000)

def metrics(data):
    content = str(data.get("content") or "")
    tokens = data.get("tokens") or {}
    orch = data.get("orchestration") or {}
    routing = data.get("routing") or {}
    finish = (
        data.get("finishReason")
        or data.get("finish_reason")
        or orch.get("finishReason")
        or orch.get("finish_reason")
        or tokens.get("finishReason")
    )
    words = len(re.findall(r"\S+", content))
    return {
        "content_len": len(content),
        "word_count": words,
        "completion_tokens": tokens.get("completion") or tokens.get("completionTokens"),
        "prompt_tokens": tokens.get("prompt") or tokens.get("promptTokens"),
        "finish_reason": finish,
        "model": data.get("model") or orch.get("model"),
        "path": routing.get("path") if isinstance(routing, dict) else routing,
        "truncated_mid": bool(content and not content.rstrip().endswith((".", ")", "]", '"', "'"))),
        "has_prayer": bool(re.search(r"\bPRAYER\b", content, re.I)),
        "has_verification": bool(re.search(r"\bVERIFICATION\b", content, re.I)),
        "tail_80": content[-80:].replace("\n", " ") if content else "",
    }

key = load_key("NYV_SDK_KEY_NSP")
if not key or len(key) < 16:
    print("PROBE BROKEN: no NSP key")
    raise SystemExit(3)

print("=== DEPLOY ===")
try:
    print("CURRENT=" + open("/opt/nyayavigya/CURRENT_DEPLOY").read().strip())
except Exception:
    print("CURRENT=missing")

try:
    for line in open(CANON):
        if line.startswith("NYV_PARTNER_MAX_TOKENS_DRAFT_FAST="):
            v = line.strip().split("=", 1)[1].strip()
            print(f"ENV_DRAFT_FAST_FLOOR=len({len(v)}) configured={'yes' if v else 'no'}")
            break
    else:
        print("ENV_DRAFT_FAST_FLOOR=not_set (code default 4096)")
except Exception as e:
    print(f"ENV_DRAFT_FAST_FLOOR=read_error {e}")

stamp = uuid.uuid4().hex[:8]
scenarios = [
    ("bail-draft-fast-medium", "legal-draft-fast", BAIL_PROMPT, {
        "parameters": {"documentType": "bail_application"},
        "options": {"draftLength": "medium"},
    }),
    ("bail-draft-full-info", "legal-draft", BAIL_PROMPT, {
        "parameters": {"documentType": "bail_application"},
        "options": {"draftLength": "comprehensive"},
        "_timeout": 120,
        "_info_only": True,
    }),
    ("slp-draft-fast", "legal-draft-fast", SLP_PROMPT, {
        "parameters": {"documentType": "criminal_petition"},
        "options": {"draftLength": "medium"},
    }),
]

print(f"\n=== DRAFT LENGTH PROBE stamp={stamp} ===")
MIN_DRAFT_FAST_CHARS = 2000
BAIL_MEDIUM_CHAR_MIN = int(8500 * 4 * 0.9)
failures = []
for label, task, prompt, extra in scenarios:
    body_extra = dict(extra or {})
    call_timeout = int(body_extra.pop("_timeout", 180))
    info_only = bool(body_extra.pop("_info_only", False))
    status, j, ms = orchestrate(key, task, prompt, body_extra=body_extra, timeout=call_timeout)
    data = j.get("data") or j
    m = metrics(data)
    print(
        f"{label}: http={status} ms={ms} task={task} "
        f"content_len={m['content_len']} words={m['word_count']} "
        f"completion_tokens={m['completion_tokens']} finish={m['finish_reason']} "
        f"path={m['path']} model={m['model']} success={j.get('success')} "
        f"prayer={m['has_prayer']} verification={m['has_verification']}"
    )
    if m["content_len"] > 0:
        print(f"  tail={m['tail_80']!r}")
    if info_only:
        print(f"  (info-only counsel probe — not gated)")
        continue
    if label.endswith("draft-fast") or "draft-fast" in label:
        if m["content_len"] < MIN_DRAFT_FAST_CHARS:
            failures.append(f"{label}: content_len={m['content_len']} < {MIN_DRAFT_FAST_CHARS}")
        if m["completion_tokens"] == 1024:
            failures.append(f"{label}: completion_tokens=1024 (legacy cap hit)")
    if label == "bail-draft-fast-medium":
        ct = m["completion_tokens"] or 0
        if ct and ct < 3500:
            failures.append(f"{label}: completion_tokens={ct} < 3500 (legacy 1024-cap or floor miss)")
        if m["content_len"] < MIN_DRAFT_FAST_CHARS:
            failures.append(f"{label}: content_len={m['content_len']} < {MIN_DRAFT_FAST_CHARS}")
        if not (m["has_prayer"] and m["has_verification"]):
            failures.append(f"{label}: missing PRAYER/VERIFICATION closing sections (prayer={m['has_prayer']} verification={m['has_verification']})")

if failures:
    print("\nPROBE FAIL:")
    for f in failures:
        print(f"  - {f}")
    raise SystemExit(2)
print("\nPROBE PASS: draft-fast content above threshold, no 1024-token cap")
PY
