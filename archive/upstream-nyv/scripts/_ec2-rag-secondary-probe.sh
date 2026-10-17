#!/usr/bin/env bash
# Diagnose why rag_documents (secondary vector store) is never written.
set +e
echo "=== embedding keys present in gateway container (names only) ==="
for k in OPENROUTER_API_KEY OPENAI_API_KEY NV_OPENAI_API_KEY VOYAGE_API_KEY COHERE_API_KEY; do
  v="$(docker exec nyv-gateway printenv "$k" 2>/dev/null)"
  if [ -n "$v" ]; then echo "$k=SET(len=${#v})"; else echo "$k=UNSET"; fi
done

ADM="$(docker exec nyv-gateway printenv DATABASE_URL_ADMIN 2>/dev/null)"; ADM="${ADM%\"}"; ADM="${ADM#\"}"
ADM="$(echo "$ADM" | sed -E 's/sslmode=no-verify/sslmode=require/; s/sslmode=verify-full/sslmode=require/')"

echo "=== pgvector extension available / installed on RDS ==="
docker run --rm --network host -e PGURL="$ADM" postgres:16-alpine \
  sh -c 'psql "$PGURL" -At -F"|" -c "SELECT '"'"'installed'"'"', extname FROM pg_extension WHERE extname='"'"'vector'"'"'; SELECT '"'"'available'"'"', name FROM pg_available_extensions WHERE name='"'"'vector'"'"';"' 2>&1

echo "=== rag_documents table exists? row count ==="
docker run --rm --network host -e PGURL="$ADM" postgres:16-alpine \
  sh -c 'psql "$PGURL" -At -F"|" -c "SELECT to_regclass('"'"'public.rag_documents'"'"'); SELECT count(*) FROM rag_documents;"' 2>&1

echo "=== live OpenRouter embeddings endpoint test (status only) ==="
ORK="$(docker exec nyv-gateway printenv OPENROUTER_API_KEY 2>/dev/null)"
if [ -n "$ORK" ]; then
  code=$(docker exec nyv-gateway sh -c "curl -sS -o /tmp/emb.json -w '%{http_code}' -m 30 -X POST https://openrouter.ai/api/v1/embeddings -H 'Content-Type: application/json' -H 'Authorization: Bearer $ORK' -d '{\"model\":\"openai/text-embedding-3-small\",\"input\":\"test\"}'")
  echo "OpenRouter /embeddings HTTP $code"
  docker exec nyv-gateway sh -c 'head -c 400 /tmp/emb.json' 2>/dev/null; echo
fi

echo "=== live OpenAI embeddings endpoint test (status only) ==="
OAK="$(docker exec nyv-gateway printenv OPENAI_API_KEY 2>/dev/null)"
[ -z "$OAK" ] && OAK="$(docker exec nyv-gateway printenv NV_OPENAI_API_KEY 2>/dev/null)"
if [ -n "$OAK" ]; then
  code=$(docker exec nyv-gateway sh -c "curl -sS -o /tmp/emb2.json -w '%{http_code}' -m 30 -X POST https://api.openai.com/v1/embeddings -H 'Content-Type: application/json' -H 'Authorization: Bearer $OAK' -d '{\"model\":\"text-embedding-3-small\",\"input\":\"test\"}'")
  echo "OpenAI /embeddings HTTP $code"
  docker exec nyv-gateway sh -c 'head -c 200 /tmp/emb2.json' 2>/dev/null; echo
else
  echo "no OpenAI key to test"
fi
