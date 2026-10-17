#!/usr/bin/env bash
# Post-deploy end-to-end verification: boot logs (hash-chain cron + doc-pipeline),
# then key DB-backed endpoints via the local gateway.
set +e
echo "=== boot wiring (gateway logs) ==="
docker logs nyv-gateway 2>&1 | rg -i "hash-chain verification cron|Daily hash-chain|Audit hash-chain integrity|Vector-store eviction" | tail -6
echo "=== health ==="
curl -s -m 15 http://localhost:5000/api/jrx/health | python3 -c 'import sys,json;d=json.load(sys.stdin);print("status",d.get("status"),"agents",d.get("totalAgents"),"ver",d.get("registryVersion") or d.get("version"))' 2>&1
echo "=== nv_app reads new tables (RLS-safe) ==="
APP="$(docker exec nyv-gateway printenv DATABASE_URL 2>/dev/null)"; APP="${APP%\"}"; APP="${APP#\"}"
APP="$(echo "$APP" | sed -E 's/sslmode=no-verify/sslmode=require/')"
docker run --rm --network host -e PGURL="$APP" postgres:16-alpine \
  sh -c 'psql "$PGURL" -At -F "|" -c "SELECT (SELECT count(*) FROM nv_llm_providers) providers, (SELECT count(*) FROM nv_courts) courts, (SELECT count(*) FROM nv_model_catalog) models, (SELECT count(*) FROM nv_statutes) statutes;"' 2>&1
