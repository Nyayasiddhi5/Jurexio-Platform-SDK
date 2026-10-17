#!/usr/bin/env bash
set -euo pipefail
ADM="$(docker exec nyv-gateway printenv DATABASE_URL_ADMIN 2>/dev/null | tr -d '\r\n')"
ADM="${ADM%\"}"; ADM="${ADM#\"}"
ADM="$(echo "$ADM" | sed -E 's/sslmode=no-verify/sslmode=require/; s/sslmode=verify-full/sslmode=require/; s/sslmode=verify-ca/sslmode=require/')"
if [ -z "$ADM" ]; then echo "FATAL: DATABASE_URL_ADMIN not set"; exit 1; fi
echo "ADMIN_URL_LEN=${#ADM}"

run_sql() {
  local file="$1"
  docker run --rm --network host -e PGURL="$ADM" -v "$file:/sql.sql:ro" postgres:16-alpine \
    sh -c 'psql "$PGURL" -v ON_ERROR_STOP=1 -f /sql.sql'
}

TMP=/tmp/jrx-backfill-$$.sql

cat > "$TMP" <<'EOSQL'
\echo === BEFORE ===
SELECT
  (SELECT COUNT(*) FROM nv_schema.nv_consent_records
   WHERE granted_at > NOW() - interval '7 days'
     AND (org_id LIKE '10%' OR org_id LIKE '11%')) AS consent_demo_7d,
  (SELECT COUNT(*) FROM nv_schema.nv_agent_metrics
   WHERE window_start > NOW() - interval '24 hours') AS agent_metrics_24h;

\echo === CONSENT refresh ===
UPDATE nv_schema.nv_consent_records
SET
  granted_at = NOW() - (random() * interval '7 days'),
  withdrawn_at = CASE
    WHEN status = 'withdrawn' THEN NOW() - (random() * interval '7 days') + interval '4 hours'
    ELSE withdrawn_at
  END
WHERE org_id LIKE '10%' OR org_id LIKE '11%';

\echo === AGENT METRICS insert ===
INSERT INTO nv_schema.nv_agent_metrics
  (agent_key, tenant_id, request_count, success_count, failure_count,
   total_latency_ms, total_cost_usd, metrics_window, window_start)
SELECT
  agent_key,
  'demo-tenant',
  req,
  GREATEST(1, FLOOR(req * (0.86 + (idx % 8) * 0.012))::int),
  GREATEST(0, req - GREATEST(1, FLOOR(req * (0.86 + (idx % 8) * 0.012))::int)),
  req * (480 + (idx % 55) * 42),
  ROUND((req * 0.018 + (idx % 17) * 0.008)::numeric, 4),
  'day',
  NOW() - (random() * interval '12 hours')
FROM (
  SELECT agent_key, (ord - 1) AS idx,
         12 + ((ord - 1) % 188) AS req
  FROM unnest(ARRAY[
    'Q-001','A-001','A-002','A-003','A-004','A-005','A-006','A-007','A-008','A-009',
    'A-010','A-011','A-012','A-013','A-014','A-015','A-016','A-017','A-018','A-019',
    'A-020','A-021','A-022','A-023','A-024','A-025','A-026','A-027','A-028','A-029',
    'A-030','A-031','A-032','A-033','A-034','A-035','A-036','A-037','A-038','A-039',
    'A-040','A-041','A-042','A-043','A-044','A-045','A-046','A-047','A-048','A-049',
    'A-050','A-051','A-052','A-053','A-054','A-055','A-056','A-057','A-058','A-059',
    'A-060','A-061','A-062','A-063','A-064','A-065','A-066','A-067','A-068','A-069',
    'A-070','A-071','A-072','A-073','A-074','A-075','A-076','A-077','A-078','A-079',
    'A-080','A-081','A-082','A-083','A-084','A-085','A-086','A-087','A-088','A-089',
    'A-090','A-091','A-092','A-093','A-094','A-095','A-096','A-097','A-098','A-099',
    'A-100','A-101','A-102','A-103','A-104','A-105','A-106','A-107','A-108','A-109',
    'A-110','A-111','A-112','A-113','A-114','A-115','A-116','A-117','A-118','A-119',
    'A-120','A-121','A-122','A-123','A-124','A-125','A-126','A-127','A-128','A-129',
    'A-130','A-131','A-132','A-133','A-134','A-135','A-136','A-137','A-138','A-139',
    'A-140','A-141','A-142','A-143','A-144','A-145','A-146','A-147'
  ]) WITH ORDINALITY AS t(agent_key, ord)
) s;

\echo === AFTER ===
SELECT
  (SELECT COUNT(*) FROM nv_schema.nv_consent_records
   WHERE granted_at > NOW() - interval '7 days'
     AND (org_id LIKE '10%' OR org_id LIKE '11%')) AS consent_demo_7d,
  (SELECT COUNT(*) FROM nv_schema.nv_agent_metrics
   WHERE window_start > NOW() - interval '24 hours') AS agent_metrics_24h,
  (SELECT COUNT(*) FROM nv_schema.nv_consent_records) AS consent_total,
  (SELECT COUNT(*) FROM nv_schema.nv_agent_metrics) AS agent_metrics_total;
EOSQL

run_sql "$TMP"
rm -f "$TMP"
echo "=== DONE ==="
