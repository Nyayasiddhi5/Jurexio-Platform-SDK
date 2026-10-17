#!/usr/bin/env bash
set +e
ADM="$(docker exec nyv-gateway printenv DATABASE_URL_ADMIN 2>/dev/null)"
ADM="${ADM%\"}"; ADM="${ADM#\"}"
ADM="$(echo "$ADM" | sed -E 's/sslmode=no-verify/sslmode=require/; s/sslmode=verify-full/sslmode=require/')"
docker run --rm --network host -e PGURL="$ADM" postgres:16-alpine sh -c 'psql "$PGURL" -At -F "|" -c "
SELECT '\''knowledge_chunks'\'', count(*) FROM knowledge_chunks;
SELECT '\''rag_documents'\'', count(*) FROM rag_documents;
SELECT '\''kc_by_jur'\'', jurisdiction, count(*) FROM knowledge_chunks GROUP BY jurisdiction ORDER BY jurisdiction;
SELECT '\''ragdoc_by_jur'\'', jurisdiction, count(*) FROM rag_documents GROUP BY jurisdiction ORDER BY jurisdiction;
"' 2>&1
