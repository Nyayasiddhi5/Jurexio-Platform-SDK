#!/usr/bin/env bash
# EC2-side probe: NSP document embeddings HTTP 400 burst (2026-09-03).
# Keys stay on EC2 — no echo, no SSM Parameter Store.
set +e

ADM="$(docker exec nyv-gateway printenv DATABASE_URL_ADMIN 2>/dev/null)"
ADM="${ADM%\"}"; ADM="${ADM#\"}"
ADM="$(echo "$ADM" | sed -E 's/sslmode=no-verify/sslmode=require/; s/sslmode=verify-full/sslmode=require/')"

runq() {
  docker run --rm --network host -e PGURL="$ADM" postgres:16-alpine \
    sh -c "psql \"\$PGURL\" -At -F '|' -c \"$1\"" 2>&1
}

echo "=== RDS sdk_api_request_logs embeddings 400s app=10 window 2026-09-03 05:20-05:30 UTC ==="
runq "SELECT count(*) FROM public.sdk_api_request_logs WHERE application_id=10 AND status_code=400 AND endpoint ILIKE '%embeddings%' AND created_at >= '2026-09-03 05:20:00+00' AND created_at <= '2026-09-03 05:30:00+00';"

echo "=== sample rows (metadata truncated) ==="
runq "SELECT created_at, endpoint, method, status_code, latency_ms, tokens_in, tokens_out, left(coalesce(metadata::text,'{}'),200) FROM public.sdk_api_request_logs WHERE application_id=10 AND status_code=400 AND endpoint ILIKE '%embeddings%' AND created_at >= '2026-09-03 05:20:00+00' AND created_at <= '2026-09-03 05:30:00+00' ORDER BY created_at LIMIT 5;"

echo "=== endpoint breakdown ==="
runq "SELECT endpoint, count(*), min(created_at), max(created_at), avg(latency_ms)::int FROM public.sdk_api_request_logs WHERE application_id=10 AND status_code=400 AND endpoint ILIKE '%embeddings%' AND created_at >= '2026-09-03 05:20:00+00' AND created_at <= '2026-09-03 05:30:00+00' GROUP BY endpoint ORDER BY count DESC;"

echo "=== wider window last 24h embeddings 400 app=10 ==="
runq "SELECT endpoint, status_code, count(*) FROM public.sdk_api_request_logs WHERE application_id=10 AND endpoint ILIKE '%embeddings%' AND created_at >= now()-interval '24 hours' GROUP BY endpoint, status_code ORDER BY count DESC;"

echo "=== gateway logs embeddings/400/OpenAI-DocIntel 05:20-05:30 UTC ==="
docker logs nyv-gateway --since "2026-09-03T05:20:00Z" --until "2026-09-03T05:30:00Z" 2>&1 \
  | grep -iE 'embeddings|OpenAI-DocIntel.*Embed|Missing required field: texts' \
  | tail -40

echo "=== reproduce payloads (NSP key on host only) ==="
ENV_FILE="/opt/Nyayavigya/secrets/.env.production"
KEY="$(grep -E '^NYV_SDK_KEY_NSP=' "$ENV_FILE" 2>/dev/null | head -1 | sed -E 's/^NYV_SDK_KEY_NSP=//; s/^"//; s/"$//')"
BASE="http://127.0.0.1:5000"
HDR=(-H "X-API-Key: $KEY" -H "X-NYV-Platform: nsp" -H "Content-Type: application/json")

code1=$(curl -sS -m 30 -o /tmp/embed_ok.json -w '%{http_code}' \
  "${HDR[@]}" -d '{"texts":["Section 302 IPC murder provision test chunk"]}' \
  "$BASE/api/jrx/gateway/documents/embeddings" 2>/dev/null || echo 000)
size1=$(wc -c < /tmp/embed_ok.json 2>/dev/null || echo 0)
succ1=$(python3 -c 'import json;d=json.load(open("/tmp/embed_ok.json"));print(d.get("success"))' 2>/dev/null || echo err)
echo "gateway/texts valid: http=$code1 resp_bytes=$size1 success=$succ1"

code2=$(curl -sS -m 10 -o /tmp/embed_bad.json -w '%{http_code}' \
  "${HDR[@]}" -d '{"documents":[{"id":"d1","content":"test legal text"}]}' \
  "$BASE/api/jrx/gateway/documents/embeddings" 2>/dev/null || echo 000)
size2=$(wc -c < /tmp/embed_bad.json 2>/dev/null || echo 0)
body2=$(cat /tmp/embed_bad.json 2>/dev/null | head -c 120)
echo "gateway/documents wrong-shape: http=$code2 resp_bytes=$size2 body=$body2"

code3=$(curl -sS -m 10 -o /tmp/embed_v1.json -w '%{http_code}' \
  "${HDR[@]}" -d '{"documents":[{"id":"d1","content":"test"}]}' \
  "$BASE/api/jrx/v1/sdk/documents/embeddings" 2>/dev/null || echo 000)
size3=$(wc -c < /tmp/embed_v1.json 2>/dev/null || echo 0)
body3=$(cat /tmp/embed_v1.json 2>/dev/null | head -c 120)
echo "v1-sdk/documents wrong-shape: http=$code3 resp_bytes=$size3 body=$body3"

code4=$(curl -sS -m 30 -o /tmp/embed_pipe.json -w '%{http_code}' \
  "${HDR[@]}" -d '{"documents":[{"id":"d1","content":"Section 302 IPC test"}]}' \
  "$BASE/api/jrx/sdk/docs-pipeline/documents/embeddings" 2>/dev/null || echo 000)
size4=$(wc -c < /tmp/embed_pipe.json 2>/dev/null || echo 0)
succ4=$(python3 -c 'import json;d=json.load(open("/tmp/embed_pipe.json"));print(d.get("success"))' 2>/dev/null || echo err)
echo "docs-pipeline/documents valid: http=$code4 resp_bytes=$size4 success=$succ4"
