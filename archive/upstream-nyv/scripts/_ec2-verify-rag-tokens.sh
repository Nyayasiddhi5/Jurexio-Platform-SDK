#!/usr/bin/env bash
set +e
APP="$(docker exec nyv-gateway printenv DATABASE_URL 2>/dev/null)"; APP="${APP%\"}"; APP="${APP#\"}"
APP="$(echo "$APP" | sed -E 's/sslmode=no-verify/sslmode=require/; s/sslmode=verify-full/sslmode=require/')"
echo "=== rag_documents by jurisdiction ==="
docker run --rm --network host -e PGURL="$APP" postgres:16-alpine \
  sh -c 'psql "$PGURL" -At -F"|" -c "SELECT jurisdiction, count(*) FROM public.rag_documents GROUP BY jurisdiction ORDER BY 1;"' 2>&1
echo "=== rag_documents total ==="
docker run --rm --network host -e PGURL="$APP" postgres:16-alpine \
  sh -c 'psql "$PGURL" -At -c "SELECT count(*) FROM public.rag_documents;"' 2>&1
echo "=== knowledge_chunks total ==="
docker run --rm --network host -e PGURL="$APP" postgres:16-alpine \
  sh -c 'psql "$PGURL" -At -c "SELECT count(*) FROM knowledge_chunks;"' 2>&1
echo "=== ai_activity: cost_usd column present + recent token rollup ==="
docker run --rm --network host -e PGURL="$APP" postgres:16-alpine \
  sh -c 'psql "$PGURL" -At -F"|" -c "SELECT count(*) FILTER (WHERE tokens_used>0) AS rows_with_tokens, COALESCE(SUM(tokens_used),0) AS tokens, COALESCE(SUM(cost_usd),0) AS cost FROM nv_schema.ai_activity WHERE created_at > NOW() - INTERVAL '"'"'2 hours'"'"';"' 2>&1
echo "=== compat view credits_charged readable by nv_app ==="
docker run --rm --network host -e PGURL="$APP" postgres:16-alpine \
  sh -c 'psql "$PGURL" -At -c "SELECT count(*) FROM public.nv_ai_activity;"' 2>&1
