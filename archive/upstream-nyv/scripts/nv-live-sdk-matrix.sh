#!/usr/bin/env bash
# nv-live-sdk-matrix.sh — Live matrix of Knowledge + Orchestrate (+ Templates) API methods.
# Usage:
#   NV_TARGET=ec2 bash scripts/jrx-live-sdk-matrix.sh
# Writes: docs/audit/sdk-knowledge-orch-matrix-<UTC>.json
set -euo pipefail
cd "$(dirname "$0")/.."

# Prefer live EC2/dev keys last so local .env test keys do not win.
for f in \
  .env \
  ../.local/secrets/ecosystem-shared-integration.env \
  ../.local/secrets/runtime.env \
  ../.local/secrets/ec2-keys-from-keysyaml.env
do
  if [[ -f "$f" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$f"
    set +a
  fi
done

BASE="${NV_BASE_URL:-https://api.nyayasiddhi.online}"
KEY="${NYV_SDK_KEY_NSP:-${NYV_SDK_KEY_SHARED:-${NYV_SDK_KEY:-}}}"
if [[ -z "$KEY" ]]; then
  echo "NO_KEY: set NYV_SDK_KEY_NSP" >&2
  exit 2
fi

OUT_DIR="docs/audit"
mkdir -p "$OUT_DIR"
STAMP=$(date -u +%Y-%m-%dT%H%M%SZ)
OUT_JSON="$OUT_DIR/sdk-knowledge-orch-matrix-${STAMP}.json"
OUT_LATEST="$OUT_DIR/sdk-knowledge-orch-matrix-latest.json"

export BASE KEY OUT_JSON
python3 <<'PY'
import json, os, time, urllib.error, urllib.request
from datetime import datetime, timezone

base = os.environ["BASE"].rstrip("/")
key = os.environ["KEY"]
out = os.environ["OUT_JSON"]

def call(method, path, body=None, timeout=45, extra_headers=None):
    url = base + path
    data = None if body is None else json.dumps(body).encode()
    headers = {
            "Authorization": f"Bearer {key}",
            "X-API-Key": key,
            "Accept": "application/json",
            **({"Content-Type": "application/json"} if body is not None else {}),
        }
    if extra_headers:
        headers.update(extra_headers)
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers=headers,
    )
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode("utf-8", "replace")
            code = r.status
            try:
                j = json.loads(raw) if raw else {}
            except Exception:
                j = {"_raw": raw[:300]}
            return {
                "ok": 200 <= code < 300,
                "http": code,
                "ms": int((time.time() - t0) * 1000),
                "success": j.get("success") if isinstance(j, dict) else None,
                "keys": list(j.keys())[:8] if isinstance(j, dict) else [],
            }
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")[:240]
        return {
            "ok": False,
            "http": e.code,
            "ms": int((time.time() - t0) * 1000),
            "error": body,
        }
    except Exception as e:
        return {
            "ok": False,
            "http": 0,
            "ms": int((time.time() - t0) * 1000),
            "error": f"{type(e).__name__}: {e}",
        }

# SDK surface → HTTP paths (KnowledgeApi + OrchestrateApi + TemplatesApi review)
cases = [
    # Knowledge
    ("knowledge.planeHealth", "GET", "/api/jrx/knowledge/plane/health", None),
    ("knowledge.getStats", "GET", "/api/jrx/knowledge/stats", None),
    ("knowledge.search", "POST", "/api/jrx/knowledge/search", {"query": "consideration Indian Contract Act", "jurisdiction": "IN", "limit": 3}),
    ("knowledge.retrieve", "POST", "/api/jrx/knowledge/retrieve", {"query": "BNS section 103", "jurisdiction": "IN"}),
    ("knowledge.searchCaselaw", "GET", "/api/jrx/knowledge/caselaw/search?q=anticipatory%20bail&jurisdiction=IN&limit=3", None),
    ("knowledge.caselawStats", "GET", "/api/jrx/knowledge/caselaw/stats", None),
    ("knowledge.caselawEmbeddingCoverage", "GET", "/api/jrx/knowledge/caselaw/embedding/coverage", None),
    ("knowledge.verifyCitation", "POST", "/api/jrx/knowledge/caselaw/verify-citation", {"citation": "AIR 1978 SC 597", "jurisdiction": "IN"}),
    ("knowledge.searchStatutes", "GET", "/api/jrx/knowledge/statutes/search?q=consideration&jurisdiction=IN&limit=3", None),
    ("knowledge.listStatuteActs", "GET", "/api/jrx/knowledge/statutes/acts?jurisdiction=IN", None),
    ("knowledge.statutesEmbeddingCoverage", "GET", "/api/jrx/knowledge/statutes/embedding/coverage", None),
    ("knowledge.extractCitations", "POST", "/api/jrx/knowledge/citations/extract", {"text": "See Kesavananda Bharati v State of Kerala (1973) 4 SCC 225."}),
    ("knowledge.searchArchive", "POST", "/api/jrx/knowledge/documents/search", {"q": "bail", "archive": "sc", "limit": 2}),
    ("knowledge.listTemplates", "GET", "/api/jrx/knowledge/templates?jurisdiction=IN", None),
    # Orchestrate
    ("orchestrate.run", "POST", "/api/jrx/orchestrate", {
        "prompt": "In two sentences, state the essentials of a valid contract under Indian law.",
        "jurisdiction": "IN",
        "agentId": "summarizer",
        "taskType": "legal-research",
        "enableRAG": True,
        "enableCoT": True,
        "maxTokens": 400,
    }),
    ("orchestrate.draftFast", "POST", "/api/jrx/orchestrate", {
        "prompt": "Draft one paragraph anticipatory bail prayer under BNSS for Karnataka.",
        "taskType": "legal-draft-fast",
        "jurisdiction": "IN",
        "parameters": {"documentType": "bail_application"},
        "options": {"draftLength": "medium"},
        "maxTokens": 512,
    }),
    ("gateway.research.query", "POST", "/api/jrx/gateway/research/query", {"query": "What is consideration under the Indian Contract Act?", "jurisdiction": "IN"}),
    # Templates + SME
    ("templates.list", "GET", "/api/jrx/templates?limit=2", None),
    ("templates.approved", "GET", "/api/jrx/templates/approved?limit=2", None),
    ("templates.reviewStats", "GET", "/api/jrx/templates/reviews/stats", None),
    ("templates.reviewQueue", "GET", "/api/jrx/templates/reviews/queue?limit=5", None),
    ("templates.catalog", "GET", "/api/jrx/templates/catalog?approvedOnly=false&limit=2", None),
    ("templates.gateway", "GET", "/api/jrx/gateway/templates?limit=2", None),
]

rows = []
pass_n = fail_n = 0
for name, method, path, body in cases:
    # Longer timeout for LLM / heavy NYS paths
    timeout = 120 if ("orchestrate" in name or "research" in name or "searchCaselaw" in name or "search" == name.split(".")[-1]) else 45
    if name in ("knowledge.search", "knowledge.searchCaselaw", "knowledge.searchStatutes", "gateway.research.query", "orchestrate.run", "orchestrate.draftFast"):
        timeout = 120
    extra = {"X-NYV-User-Id": "90001"} if name == "orchestrate.draftFast" else None
    result = call(method, path, body, timeout=timeout, extra_headers=extra)
    result["sdkMethod"] = name
    result["httpMethod"] = method
    result["path"] = path.split("?")[0]
    rows.append(result)
    if result.get("ok"):
        pass_n += 1
        mark = "PASS"
    else:
        fail_n += 1
        mark = "FAIL"
    print(f"{mark} {name} http={result.get('http')} ms={result.get('ms')}")

report = {
    "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    "baseUrl": base,
    "platform": "NSP",
    "summary": {"pass": pass_n, "fail": fail_n, "total": len(rows)},
    "results": rows,
}
with open(out, "w") as f:
    json.dump(report, f, indent=2)
latest = os.path.join(os.path.dirname(out), "sdk-knowledge-orch-matrix-latest.json")
with open(latest, "w") as f:
    json.dump(report, f, indent=2)
print(json.dumps(report["summary"]))
print("wrote", out)
PY
