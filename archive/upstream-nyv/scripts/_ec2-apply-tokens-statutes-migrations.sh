#!/usr/bin/env bash
# Apply the 2026-06-26 wave migrations on RDS as the admin role:
#   - nv-ai-activity-compat-view.sql  (adds cost_usd column + org_id mapping, recreates view)
#   - statutes-expansion.sql          (138 foundational statutes, idempotent upsert)
# Runs ON EC2 via nv-ec2-ssm-run.sh. Reads the migration files from the freshly
# deployed repo and the admin DATABASE_URL from the gateway container env.
set +e

REPO="$(ls -dt /opt/Nyayavigya/repo/*/ 2>/dev/null | head -1)"
if [ -z "$REPO" ]; then echo "FATAL: no deployed repo found under /opt/Nyayavigya/repo"; exit 1; fi
echo "=== using repo: $REPO"

ADM="$(docker exec nyv-gateway printenv DATABASE_URL_ADMIN 2>/dev/null)"
ADM="${ADM%\"}"; ADM="${ADM#\"}"
ADM="$(echo "$ADM" | sed -E 's/sslmode=no-verify/sslmode=require/; s/sslmode=verify-full/sslmode=require/')"
if [ -z "$ADM" ]; then echo "FATAL: no DATABASE_URL_ADMIN in gateway container"; exit 1; fi

MIG="${REPO%/}/migrations"
for f in 2026-06-25-nv-ai-activity-compat-view.sql 2026-06-25-statutes-expansion.sql; do
  if [ ! -f "$MIG/$f" ]; then echo "MISSING migration: $MIG/$f"; continue; fi
  echo "=== applying $f"
  docker run --rm --network host -v "$MIG":/mig -e PGURL="$ADM" postgres:16-alpine \
    sh -c 'psql "$PGURL" -v ON_ERROR_STOP=1 -f /mig/'"$f" 2>&1 | tail -15
  echo "=== done $f (exit ${PIPESTATUS[0]})"
done

echo "=== verify: statute counts by jurisdiction"
docker run --rm --network host -e PGURL="$ADM" postgres:16-alpine \
  sh -c 'psql "$PGURL" -At -F"|" -c "SELECT jurisdiction, count(*) FROM public.nv_statutes GROUP BY jurisdiction ORDER BY jurisdiction;"' 2>&1

echo "=== verify: ai_activity cost_usd column + nv_ai_activity view shape"
docker run --rm --network host -e PGURL="$ADM" postgres:16-alpine \
  sh -c 'psql "$PGURL" -At -F"|" -c "SELECT column_name FROM information_schema.columns WHERE table_schema='"'"'nv_schema'"'"' AND table_name='"'"'ai_activity'"'"' AND column_name='"'"'cost_usd'"'"';"' 2>&1

echo "=== verify: nv_app can read view with cost"
APP="$(docker exec nyv-gateway printenv DATABASE_URL 2>/dev/null)"; APP="${APP%\"}"; APP="${APP#\"}"
APP="$(echo "$APP" | sed -E 's/sslmode=no-verify/sslmode=require/; s/sslmode=verify-full/sslmode=require/')"
docker run --rm --network host -e PGURL="$APP" postgres:16-alpine \
  sh -c 'psql "$PGURL" -At -F"|" -c "SELECT '"'"'view_read'"'"', count(*), COALESCE(SUM(input_tokens+output_tokens),0), COALESCE(SUM(credits_charged),0) FROM public.nv_ai_activity;"' 2>&1
