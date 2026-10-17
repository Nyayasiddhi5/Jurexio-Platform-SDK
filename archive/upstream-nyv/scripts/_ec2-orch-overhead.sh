#!/usr/bin/env bash
# NV-ORCH-OVERHEAD-001 — where the wall time goes inside our own orchestration
# vs a direct provider call, for the identical prompt.
set -euo pipefail
CANON="/opt/Nyayavigya/secrets/.env.production"
API="https://api.nyayasiddhi.online"
NSPK=$(grep -E '^NYV_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')

PROMPT='You are Indian counsel. In under 400 words give the anticipatory bail strategy under BNSS 482 for a first-time accused in an economic offence in Telangana. Cite only the statutory provisions you are certain of.'

echo "=== live flags that add latency ==="
for k in NYV_NSP_COUNSEL_QUEEN NYV_LLM_HEDGE_MS NYV_LLM_PROVIDER_TIMEOUT_MS NYV_PARTNER_MAX_TOKENS_CHAT NYV_PARTNER_MAX_TOKENS_FLOOR NYV_STATUTE_QA_GROUNDING NYV_LEGAL_COMPREHENSIVE NYV_PARTNER_RAG_TOPK NYV_ENABLE_SELF_RAG NYV_LMCACHE_ENABLED; do
  v=$(docker exec nyv-gateway printenv "$k" 2>/dev/null || echo "UNSET")
  printf '%-34s %s\n' "$k" "${v:-EMPTY}"
done

echo
echo "=== orchestrate x2 (same prompt: cold then warm/cache) ==="
for i in 1 2; do
  curl -sS -m 200 -o /tmp/ov.json -w "run${i} HTTP %{http_code} total=%{time_total} ttfb=%{time_starttransfer}\n" \
    -X POST -H "X-API-Key: ${NSPK}" -H 'Content-Type: application/json' -H 'X-NYV-Consent: granted' \
    -d "$(python3 -c 'import json,sys;print(json.dumps({"prompt":sys.argv[1],"jurisdiction":"IN"}))' "$PROMPT")" \
    "${API}/api/jrx/orchestrate" || echo "run${i} HTTP 000"
  python3 - <<'PY'
import json
d = json.load(open("/tmp/ov.json"))
n = d.get("data") if isinstance(d.get("data"), dict) else d
print("   model", n.get("model"), "| provider", n.get("provider"), "| respTime", n.get("responseTime"))
tk = n.get("tokens") or {}
print("   tokens", tk.get("prompt"), "->", tk.get("completion"), "total", tk.get("total"))
meta = n.get("orchestration") or {}
print("   layers", meta.get("layersUsed"), "| cached", meta.get("cached") or n.get("cached"))
PY
done

echo
echo "=== stage timings from gateway logs (last 4m) ==="
docker logs --since 4m nyv-gateway 2>&1 | grep -oiE '(queen|rag|memory|self.?rag|hedge|cot|citation|hallucination|cache)[^"]{0,60}?[0-9]{3,6} ?ms' | tail -40 || echo "none"

echo
echo "=== hedge activity (last 4m) ==="
docker logs --since 4m nyv-gateway 2>&1 | grep -icE 'hedge' || echo 0
docker logs --since 4m nyv-gateway 2>&1 | grep -oE 'hedge[^"]{0,120}' | tail -12 || true

echo
echo "=== LLM attempts per request (last 4m) ==="
docker logs --since 4m nyv-gateway 2>&1 | grep -cE '\[Bedrock\] attempt failed' || echo 0
docker logs --since 4m nyv-gateway 2>&1 | grep -oE '(gemini-3[^ ",]*|us\.anthropic[^ ",]*|global\.anthropic[^ ",]*|nova-pro[^ ",]*)' | sort | uniq -c | sort -rn | head -12 || true
