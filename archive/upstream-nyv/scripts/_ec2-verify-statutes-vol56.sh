#!/usr/bin/env bash
set +e
CANON="/opt/Nyayavigya/secrets/.env.production"
NV_DEMO_PW="$(grep -E '^NV_DEMO_PASSWORD=' "$CANON" | head -1 | cut -d= -f2- | tr -d "\"'" | tr -d '\r\n')"
code=$(curl -sS -o /tmp/login.json -w '%{http_code}' -m 20 -X POST http://127.0.0.1:5000/api/jrx/auth/login \
  -H 'Content-Type: application/json' -H 'Origin: https://api.nyayasiddhi.online' \
  -d "{\"email\":\"admin@nyayavigya.in\",\"password\":\"${NV_DEMO_PW}\"}")
echo "login HTTP ${code}"
TOKEN="$(python3 -c 'import json;print(json.load(open("/tmp/login.json")).get("token") or json.load(open("/tmp/login.json")).get("accessToken") or "")' 2>/dev/null)"

echo "=== idempotent re-backfill US (expect inserted=0, skipped=156) ==="
curl -sS -m 600 -X POST http://127.0.0.1:5000/api/jrx/rag/collections/backfill-statutes \
  -H 'Content-Type: application/json' -H "Authorization: Bearer ${TOKEN}" -H 'Origin: https://api.nyayasiddhi.online' \
  -d '{"jurisdiction":"US","limit":5000,"dryRun":false}'; echo

ADM="$(docker exec nyv-gateway printenv DATABASE_URL_ADMIN 2>/dev/null)"; ADM="${ADM%\"}"; ADM="${ADM#\"}"
ADM="$(echo "$ADM" | sed -E 's/sslmode=no-verify/sslmode=require/; s/sslmode=verify-full/sslmode=require/')"
q() { docker run --rm --network host -e PGURL="$ADM" postgres:16-alpine sh -c "psql \"\$PGURL\" -At -F'|' -c \"$1\"" 2>&1; }

echo "=== nv_statutes by jurisdiction ==="; q "SELECT jurisdiction,count(*) FROM public.nv_statutes WHERE is_repealed=false GROUP BY jurisdiction ORDER BY 1;"
echo "=== nv_statutes total ==="; q "SELECT count(*) FROM public.nv_statutes WHERE is_repealed=false;"
echo "=== knowledge_chunks total ==="; q "SELECT count(*) FROM knowledge_chunks;"
echo "=== rag_documents total ==="; q "SELECT count(*) FROM rag_documents;"

echo "=== FTS: 'admiralty maritime' (IN ADMIRALTY2017) ==="
q "SELECT jurisdiction,act_short_title,section_number,section_title FROM public.nv_statutes WHERE search_vector @@ plainto_tsquery('english','admiralty maritime arrest vessel') LIMIT 3;"
echo "=== FTS: 'CERCLA superfund' (US CERCLA §107) ==="
q "SELECT jurisdiction,act_short_title,section_number,section_title FROM public.nv_statutes WHERE search_vector @@ plainto_tsquery('english','superfund hazardous substances liability') LIMIT 3;"
echo "=== FTS: 'GST input tax credit' (IN GST §17) ==="
q "SELECT jurisdiction,act_short_title,section_number,section_title FROM public.nv_statutes WHERE search_vector @@ plainto_tsquery('english','input tax credit blocked') LIMIT 3;"
echo "=== FTS: 'cheque dishonour 138' (IN NIA §138 base) ==="
q "SELECT jurisdiction,act_short_title,section_number,section_title FROM public.nv_statutes WHERE search_vector @@ plainto_tsquery('english','dishonour cheque insufficiency') LIMIT 3;"
echo "=== FTS: 'GST council 101st amendment' (IN CONST-AMEND) ==="
q "SELECT jurisdiction,act_short_title,section_number,section_title FROM public.nv_statutes WHERE search_vector @@ plainto_tsquery('english','GST council amendment') LIMIT 3;"
echo "=== FTS: 'like-kind exchange' (US IRC §1031) ==="
q "SELECT jurisdiction,act_short_title,section_number,section_title FROM public.nv_statutes WHERE search_vector @@ plainto_tsquery('english','like-kind exchange real property') LIMIT 3;"
