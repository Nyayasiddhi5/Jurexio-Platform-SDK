#!/usr/bin/env bash
set +e
ADM="$(docker exec nyv-gateway printenv DATABASE_URL_ADMIN 2>/dev/null)"; ADM="${ADM%\"}"; ADM="${ADM#\"}"
ADM="$(echo "$ADM" | sed -E 's/sslmode=no-verify/sslmode=require/; s/sslmode=verify-full/sslmode=require/')"
runq() { docker run --rm --network host -e PGURL="$ADM" postgres:16-alpine sh -c "psql \"\$PGURL\" -At -F '|' -c \"$1\"" 2>&1; }

echo "=== MASTER DATA (RDS) ==="
echo "llm_providers   : $(runq "SELECT count(*) FROM public.nv_llm_providers;")  active=$(runq "SELECT count(*) FROM public.nv_llm_providers WHERE is_active;")"
echo "model_catalog   : $(runq "SELECT count(*) FROM public.nv_model_catalog;")"
echo "courts          : $(runq "SELECT count(*) FROM public.nv_courts;")  | by juris: $(runq "SELECT string_agg(jurisdiction||':'||c,' ') FROM (SELECT jurisdiction,count(*) c FROM public.nv_courts GROUP BY jurisdiction ORDER BY jurisdiction) t;")"
echo "statutes        : $(runq "SELECT count(*) FROM public.nv_statutes;")  | by juris: $(runq "SELECT string_agg(jurisdiction||':'||c,' ') FROM (SELECT jurisdiction,count(*) c FROM public.nv_statutes GROUP BY jurisdiction ORDER BY jurisdiction) t;")"
echo "legal_agents    : $(runq "SELECT count(*) FROM public.legal_agents;")  distinct_agent_id=$(runq "SELECT count(DISTINCT agent_id) FROM public.legal_agents;")"
echo "organizations   : $(runq "SELECT count(*) FROM public.nv_organizations;")"
echo "users           : $(runq "SELECT count(*) FROM public.nv_users;")"
echo "sdk_applications: $(runq "SELECT count(*) FROM public.sdk_applications;")  api_keys=$(runq "SELECT count(*) FROM nv_schema.sdk_app_api_keys;")"

echo ""
echo "=== AUDIT / ACTIVITY TRAIL ==="
echo "ai_activity (nv_schema)    : total=$(runq "SELECT count(*) FROM nv_schema.ai_activity;")  last24h=$(runq "SELECT count(*) FROM nv_schema.ai_activity WHERE created_at>now()-interval '24 hours';")  last=$(runq "SELECT max(created_at) FROM nv_schema.ai_activity;")"
echo "nv_audit_logs (hash chain) : total=$(runq "SELECT count(*) FROM nv_schema.nv_audit_logs;")  last24h=$(runq "SELECT count(*) FROM nv_schema.nv_audit_logs WHERE created_at>now()-interval '24 hours';")  last=$(runq "SELECT max(created_at) FROM nv_schema.nv_audit_logs;")"
echo "sdk_api_request_logs       : total=$(runq "SELECT count(*) FROM public.sdk_api_request_logs;")  last24h=$(runq "SELECT count(*) FROM public.sdk_api_request_logs WHERE created_at>now()-interval '24 hours';")  last=$(runq "SELECT max(created_at) FROM public.sdk_api_request_logs;")"
echo "usage_logs (agent metering): total=$(runq "SELECT count(*) FROM nv_schema.usage_logs;")  last=$(runq "SELECT max(created_at) FROM nv_schema.usage_logs;")"
echo "append policies present    : $(runq "SELECT string_agg(tablename||'.'||policyname,' ') FROM pg_policies WHERE policyname LIKE '%_append';")"

echo ""
echo "=== RAG ==="
echo "knowledge_chunks : total=$(runq "SELECT count(*) FROM public.knowledge_chunks;")"
echo "  by source/type : $(runq "SELECT string_agg(COALESCE(source_type,'?')||':'||c,' ') FROM (SELECT source_type, count(*) c FROM public.knowledge_chunks GROUP BY source_type ORDER BY c DESC LIMIT 8) t;" 2>/dev/null)"
echo "  statute chunks : $(runq "SELECT count(*) FROM public.knowledge_chunks WHERE content ILIKE '%statute%' OR metadata::text ILIKE '%statute%' OR source_type ILIKE '%statute%';" 2>/dev/null)"
echo "rag_documents    : $(runq "SELECT count(*) FROM public.rag_documents;" 2>/dev/null)"
