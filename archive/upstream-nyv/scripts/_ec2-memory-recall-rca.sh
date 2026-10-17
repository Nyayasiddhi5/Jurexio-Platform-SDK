#!/bin/sh
# Why does memory.tiered.recall hang for 30s? Two hypotheses from reading
# nvMemoryService.retrieve():
#   H1 the FTS branch computes to_tsvector(value::text) per row at query time with
#      no functional index -> seq scan over the user's whole memory.
#   H2 after SELECT it issues one sequential awaited UPDATE per returned row
#      (limit default 20) -> 20 extra round trips per recall.
# Positive control: table must exist and the column list must be non-empty.
set -e
CANON=/opt/Nyayavigya/secrets/.env.production
DBURL=`grep -E '^DATABASE_URL=' "$CANON" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "\r\n"`
DBURL=`printf %s "$DBURL" | sed -e 's/sslmode=no-verify/sslmode=require/'`
if [ -z "$DBURL" ]; then echo "PROBE BROKEN: no DATABASE_URL"; exit 3; fi

docker exec -i nyv-postgres psql "$DBURL" -v ON_ERROR_STOP=1 <<'SQL'
\timing on
SELECT count(*) AS control_columns FROM information_schema.columns
 WHERE table_schema='nv_schema' AND table_name='memory_entries';

SELECT pg_size_pretty(pg_total_relation_size('nv_schema.memory_entries')) AS total_size,
       (SELECT count(*) FROM nv_schema.memory_entries) AS row_count;

\echo '--- indexes present ---'
SELECT indexname, indexdef FROM pg_indexes
 WHERE schemaname='nv_schema' AND tablename='memory_entries';

\echo '--- rows per user (is any single user large?) ---'
SELECT user_id, count(*) AS rows FROM nv_schema.memory_entries
 GROUP BY user_id ORDER BY 2 DESC LIMIT 5;

\echo '--- H1: EXPLAIN the FTS branch actually used at runtime ---'
EXPLAIN (ANALYZE, BUFFERS, TIMING)
SELECT *, ts_rank_cd(to_tsvector('simple', COALESCE(value::text, '')), plainto_tsquery('simple', 'anticipatory bail')) AS _relevance
FROM nv_schema.memory_entries
WHERE user_id = (SELECT user_id FROM nv_schema.memory_entries GROUP BY user_id ORDER BY count(*) DESC LIMIT 1)
  AND (expires_at IS NULL OR expires_at > NOW())
ORDER BY _relevance DESC, importance DESC, last_accessed_at DESC
LIMIT 20;
SQL

echo ""
echo "=== H2: how many UPDATEs per recall? (source-level count) ==="
docker exec nyv-gateway sh -c "grep -c 'access_count = access_count + 1' /app/src/services/jrx-orchestration-services.ts"
echo "  (each returned row triggers one awaited UPDATE; default limit=20)"

echo ""
echo "=== live recall latency signature in the last 2h ==="
LOG=`docker logs nyv-gateway --since 2h 2>&1`
echo -n "  recall budget exhausted     : "; printf '%s' "$LOG" | grep -c "recall budget exhausted" || true
echo -n "  queen.mw.pre.memory spans   : "; printf '%s' "$LOG" | grep -c "queen.mw.pre.memory" || true
echo -n "  slow memory spans (>5000ms) : "; printf '%s' "$LOG" | grep -oE '"span":"queen\.mw\.pre\.memory"[^}]*"durationMs":[0-9]{4,}' | wc -l
echo "  control: log_lines=`printf '%s' "$LOG" | wc -l`"
