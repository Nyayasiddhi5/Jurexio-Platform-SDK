#!/usr/bin/env bash
# Why is the cheap Bedrock leaf pick failing and falling back to the expensive
# Gemini Pro? Dispatch says qwen.qwen3-vl-235b-a22b, but every billed completion
# is gemini-3-1-pro-preview and the log carries 6x "[Bedrock] attempt failed".
set -uo pipefail
GID=$(docker ps --filter 'name=gateway' --format '{{.ID}}' | head -1)

echo "=== configured bedrock region ==="
docker exec "$GID" printenv AWS_BEDROCK_REGION AWS_REGION 2>/dev/null | sed 's/^/   /'

echo
echo "=== full [Bedrock] attempt failed errors (most recent) ==="
docker logs --tail 400000 "$GID" 2>&1 | grep '\[Bedrock\] attempt failed' | tail -8 \
  | python3 -c "
import sys,json
for l in sys.stdin:
    try: r=json.loads(l)
    except Exception:
        print('   RAW '+l[:400]); continue
    for k in ('modelId','model','region','err','error','message','msg','statusCode','name'):
        if k in r and r[k] not in (None,''):
            print(f'   {k} = {str(r[k])[:300]}')
    print('   ---')
"

echo
echo "=== which model ids does this account actually serve? (converse probe) ==="
REG=$(docker exec "$GID" printenv AWS_BEDROCK_REGION 2>/dev/null || echo us-east-1)
for M in \
  qwen.qwen3-vl-235b-a22b \
  qwen.qwen3-235b-a22b-2507-v1:0 \
  qwen.qwen3-next-80b-a3b \
  deepseek.v3.2 \
  google.gemma-3-27b-it \
  zai.glm-5 \
  moonshotai.kimi-k2.5 \
  global.amazon.nova-2-lite-v1:0 \
  us.amazon.nova-pro-v1:0
do
  OUT=$(aws bedrock-runtime converse --region "$REG" --model-id "$M" \
    --messages '[{"role":"user","content":[{"text":"Reply with the single word OK."}]}]' \
    --inference-config '{"maxTokens":16}' 2>&1)
  if echo "$OUT" | grep -q '"text"'; then
    printf '   %-42s OK\n' "$M"
  else
    printf '   %-42s FAIL %s\n' "$M" "$(echo "$OUT" | tr '\n' ' ' | sed 's/.*: //' | cut -c1-110)"
  fi
done
