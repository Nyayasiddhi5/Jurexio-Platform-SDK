#!/usr/bin/env bash
# List + invoke Bedrock models this API key can use. Never print tokens.
set -euo pipefail
echo "=== BEDROCK INVENTORY $(date -u +%FT%TZ) ==="

TOKEN_FILE=/tmp/.nv-bt
umask 077
docker exec nyv-gateway sh -c 'printf %s "$AWS_BEARER_TOKEN_BEDROCK_US_EAST_1$AWS_BEARER_TOKEN_BEDROCK$BEDROCK_API_KEY"' > /dev/null
docker exec nyv-gateway printenv AWS_BEARER_TOKEN_BEDROCK_US_EAST_1 > "$TOKEN_FILE" 2>/dev/null || true
if [ ! -s "$TOKEN_FILE" ]; then
  docker exec nyv-gateway printenv AWS_BEARER_TOKEN_BEDROCK > "$TOKEN_FILE" 2>/dev/null || true
fi
if [ ! -s "$TOKEN_FILE" ]; then
  docker exec nyv-gateway printenv BEDROCK_API_KEY > "$TOKEN_FILE" 2>/dev/null || true
fi
python3 - <<'PY'
import json, ssl, urllib.error, urllib.parse, urllib.request
from pathlib import Path

token = Path("/tmp/.nv-bt").read_text().strip()
print("bearer_present=" + ("yes" if token else "no") + " len=" + str(len(token)))
if not token:
    raise SystemExit(0)
ctx = ssl.create_default_context()

def http(method, host, path, body=None, timeout=25):
    data = None if body is None else body.encode("utf-8")
    headers = {"Authorization": "Bearer " + token, "Accept": "application/json"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request("https://" + host + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as res:
            raw = res.read(400_000)
            return res.status, raw.decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        raw = e.read(800).decode("utf-8", "replace")
        return e.code, raw
    except Exception as e:
        return 0, str(e)[:160]

def classify(mid):
    s = (mid or "").lower()
    if any(x in s for x in ("embed", "titan-e", "cohere.embed")):
        return "embed"
    if any(x in s for x in ("image", "stable", "canvas", "nova-reel", "nova-canvas")):
        return "image"
    if "anthropic" in s or "claude" in s:
        return "claude"
    if "nova" in s:
        return "nova"
    if "deepseek" in s:
        return "deepseek"
    return "other-text"

for label, path in (
    ("ListFoundationModels", "/foundation-models"),
    ("ListInferenceProfiles", "/inference-profiles?maxResults=1000"),
):
    status, raw = http("GET", "bedrock.us-east-1.amazonaws.com", path)
    print(f"LIST {label} HTTP {status}")
    if status != 200:
        print("  snippet=" + " ".join(raw.split())[:180])
        continue
    try:
        payload = json.loads(raw)
    except Exception:
        print("  parse_fail")
        continue
    models = payload.get("modelSummaries") or payload.get("inferenceProfileSummaries") or payload.get("models") or []
    print(f"  count={len(models)}")
    for m in models:
        mid = m.get("modelId") or m.get("inferenceProfileId") or m.get("modelArn") or m.get("inferenceProfileArn") or ""
        if not mid:
            continue
        name = m.get("modelName") or m.get("inferenceProfileName") or ""
        print(f"  LISTED {classify(mid)} {mid}" + (f" | {name}" if name else ""))

def body_for(kind):
    if kind == "claude":
        return json.dumps({
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 16,
            "messages": [{"role": "user", "content": "Reply with the single word OK."}],
        })
    if kind == "nova":
        return json.dumps({
            "schemaVersion": "messages-v1",
            "messages": [{"role": "user", "content": [{"text": "Reply with the single word OK."}]}],
            "inferenceConfig": {"maxNewTokens": 128, "temperature": 0},
        })
    if kind == "meta":
        return json.dumps({"prompt": "Reply with the single word OK.", "max_gen_len": 16, "temperature": 0})
    return json.dumps({"messages": [{"role": "user", "content": "Reply with the single word OK."}], "max_tokens": 16})

def invoke(model_id, kind):
    path = "/model/" + urllib.parse.quote(model_id, safe="") + "/invoke"
    status, raw = http("POST", "bedrock-runtime.us-east-1.amazonaws.com", path, body_for(kind))
    snippet = " ".join(raw.replace('"', "'").split())[:140]
    return status, snippet

claude = [
    ("global.anthropic.claude-opus-5", "claude"),
    ("us.anthropic.claude-opus-5", "claude"),
    ("anthropic.claude-opus-5", "claude"),
    ("global.anthropic.claude-opus-4-8", "claude"),
    ("us.anthropic.claude-opus-4-8", "claude"),
    ("global.anthropic.claude-opus-4-7", "claude"),
    ("us.anthropic.claude-opus-4-7", "claude"),
    ("global.anthropic.claude-opus-4-7-v1", "claude"),
    ("anthropic.claude-opus-4-7-v1:0", "claude"),
    ("global.anthropic.claude-sonnet-5", "claude"),
    ("us.anthropic.claude-sonnet-5", "claude"),
    ("anthropic.claude-sonnet-5", "claude"),
    ("global.anthropic.claude-sonnet-4-6", "claude"),
    ("global.anthropic.claude-opus-4-6-v1", "claude"),
    ("global.anthropic.claude-haiku-4-5", "claude"),
    ("global.anthropic.claude-haiku-4-5-20251001-v1:0", "claude"),
    ("us.anthropic.claude-haiku-4-5-20251001-v1:0", "claude"),
    ("global.anthropic.claude-fable-5", "claude"),
    ("us.anthropic.claude-fable-5", "claude"),
    ("anthropic.claude-3-haiku-20240307-v1:0", "claude"),
    ("apac.anthropic.claude-3-5-sonnet-20241022-v2:0", "claude"),
]
other = [
    ("deepseek.v3.2", "openai"),
    ("us.deepseek.r1-v1:0", "openai"),
    ("qwen.qwen3-235b-a22b-2507-v1:0", "openai"),
    ("qwen.qwen3-next-80b-a3b", "openai"),
    ("qwen.qwen3-vl-235b-a22b", "openai"),
    ("mistral.mistral-large-3-675b-instruct", "openai"),
    ("moonshotai.kimi-k2.5", "openai"),
    ("moonshot.kimi-k2-thinking", "openai"),
    ("google.gemma-3-27b-it", "openai"),
    ("zai.glm-5", "openai"),
    ("us.amazon.nova-pro-v1:0", "nova"),
    ("apac.amazon.nova-pro-v1:0", "nova"),
    ("global.amazon.nova-2-lite-v1:0", "nova"),
    ("us.amazon.nova-2-lite-v1:0", "nova"),
    ("amazon.nova-pro-v1:0", "nova"),
    ("meta.llama3-70b-instruct-v1:0", "meta"),
]

print("=== INVOKE CLAUDE LATEST ===")
pass_ids, fail_ids = [], []
for mid, kind in claude:
    status, snippet = invoke(mid, kind)
    ok = status == 200
    print(("PASS" if ok else "FAIL") + f" {mid} HTTP {status} {snippet}")
    (pass_ids if ok else fail_ids).append(f"{mid}:{status}")
print("=== INVOKE CATALOG OTHER ===")
for mid, kind in other:
    status, snippet = invoke(mid, kind)
    ok = status == 200
    print(("PASS" if ok else "FAIL") + f" {mid} HTTP {status} {snippet}")
    (pass_ids if ok else fail_ids).append(f"{mid}:{status}")
print("PASS_N=" + str(len(pass_ids)))
print("FAIL_N=" + str(len(fail_ids)))
print("PASS_IDS=" + ",".join(pass_ids))
PY
rm -f "$TOKEN_FILE"
