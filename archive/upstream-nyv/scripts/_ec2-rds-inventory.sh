#!/usr/bin/env bash
# Read-only RDS inventory: admin-cred check, privileges, table list + row counts, master-data coverage.
set +e
APP="$(docker exec nyv-gateway printenv DATABASE_URL 2>/dev/null)"
ADM="$(docker exec nyv-gateway printenv DATABASE_URL_ADMIN 2>/dev/null)"
norm() { echo "$1" | sed -E 's/sslmode=no-verify/sslmode=require/; s/sslmode=verify-full/sslmode=require/; s/sslmode=verify-ca/sslmode=require/'; }
APP="$(norm "${APP%\"}")"; ADM="$(norm "${ADM%\"}")"
echo "APP_URL_LEN=${#APP}  ADMIN_URL_LEN=${#ADM}"
URL="$APP"; ROLE="app"
if [ -n "$ADM" ]; then URL="$ADM"; ROLE="admin"; fi
echo "USING_ROLE=$ROLE"
q() {
  docker run --rm --network host -e PGURL="$URL" -e SQL="$1" postgres:16-alpine \
    sh -c 'psql "$PGURL" -At -F "|" -v ON_ERROR_STOP=0 -c "$SQL"' 2>&1
}
echo "=== whoami / privileges ==="
q "SELECT current_user, has_schema_privilege(current_user,'public','CREATE') AS pub_create, has_schema_privilege(current_user,'nv_schema','CREATE') AS nvs_create;"
echo "=== public tables + approx rows (top 60 by rows) ==="
q "SELECT relname, n_live_tup FROM pg_stat_user_tables WHERE schemaname='public' ORDER BY n_live_tup DESC LIMIT 60;"
echo "=== nv_schema tables + approx rows ==="
q "SELECT relname, n_live_tup FROM pg_stat_user_tables WHERE schemaname='nv_schema' ORDER BY n_live_tup DESC LIMIT 40;"
echo "=== master-data exact counts (public) ==="
q "SELECT 'legal_agents' t, count(*) n FROM legal_agents
   UNION ALL SELECT 'nv_model_catalog', count(*) FROM nv_model_catalog
   UNION ALL SELECT 'nv_statutes', count(*) FROM nv_statutes
   UNION ALL SELECT 'nv_organizations', count(*) FROM nv_organizations
   UNION ALL SELECT 'nv_users', count(*) FROM nv_users
   UNION ALL SELECT 'nv_jurisdiction_configs', count(*) FROM nv_jurisdiction_configs
   UNION ALL SELECT 'nv_mcp_tools', count(*) FROM nv_mcp_tools
   UNION ALL SELECT 'nv_sdk_applications', count(*) FROM nv_sdk_applications
   ORDER BY 1;"
echo "=== presence of often-missing tables ==="
q "SELECT 'nv_llm_providers' t, to_regclass('public.nv_llm_providers')::text r
   UNION ALL SELECT 'nv_courts', to_regclass('public.nv_courts')::text
   UNION ALL SELECT 'scoped_feature_flags', to_regclass('public.scoped_feature_flags')::text
   UNION ALL SELECT 'nv_feature_flags', to_regclass('public.nv_feature_flags')::text
   UNION ALL SELECT 'nv_ai_activity', to_regclass('public.nv_ai_activity')::text
   UNION ALL SELECT 'knowledge_chunks', to_regclass('public.knowledge_chunks')::text
   UNION ALL SELECT 'nv_audit_logs(nv_schema)', to_regclass('nv_schema.nv_audit_logs')::text
   UNION ALL SELECT 'sdk_api_request_logs', to_regclass('public.sdk_api_request_logs')::text;"
echo "=== users / orgs detail ==="
q "SELECT email, role, tier, org_id, is_active FROM nv_users ORDER BY id LIMIT 20;"
q "SELECT id, name, slug, tier, is_active FROM nv_organizations ORDER BY id LIMIT 20;"
echo "=== feature flags counts ==="
q "SELECT 'scoped_feature_flags' t, count(*) FROM scoped_feature_flags UNION ALL SELECT 'nv_feature_flags', count(*) FROM nv_feature_flags;"
echo "=== legal_agents duplicate scan (by agent_id) ==="
q "SELECT count(*) total, count(DISTINCT agent_id) distinct_id, count(*)-count(DISTINCT agent_id) dupes FROM legal_agents;"
echo "=== legal_agents by jurisdictions value (top) ==="
q "SELECT COALESCE(jurisdictions::text,'(null)') j, count(*) FROM legal_agents GROUP BY 1 ORDER BY 2 DESC LIMIT 12;"
