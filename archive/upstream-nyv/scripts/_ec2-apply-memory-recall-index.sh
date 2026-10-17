#!/usr/bin/env bash
# Apply migrations/2026-08-17-memory-recall-index.sql on RDS as admin, then verify.
#
# NV-MEM-RECALL-INDEX-001. Follows the established _ec2-apply-* convention:
# DATABASE_URL_ADMIN from the running container, sslmode normalised for psql, DDL
# executed from the deployed repo copy, then verified with the APP role.
#
# The migration uses CREATE INDEX CONCURRENTLY, which cannot run inside a
# transaction block — psql runs each statement autocommit by default, so no
# BEGIN/COMMIT wrapper is used and ON_ERROR_STOP is still safe.
set +e
REPO="$(ls -dt /opt/Nyayavigya/repo/*/ 2>/dev/null | head -1)"
echo "=== repo: $REPO"
MIGFILE="2026-08-17-memory-recall-index.sql"
if [ ! -f "${REPO%/}/migrations/$MIGFILE" ]; then
  echo "PROBE BROKEN: migration not found in deployed repo — deploy first"; exit 3
fi

ADM="$(docker exec nyv-gateway printenv DATABASE_URL_ADMIN 2>/dev/null)"; ADM="${ADM%\"}"; ADM="${ADM#\"}"
ADM="$(echo "$ADM" | sed -E 's/sslmode=no-verify/sslmode=require/; s/sslmode=verify-full/sslmode=require/')"
if [ -z "$ADM" ]; then echo "PROBE BROKEN: no DATABASE_URL_ADMIN"; exit 3; fi

echo "=== BEFORE: recall plan on the largest user (expect per-row ts_rank_cd sort) ==="
docker run --rm --network host -e PGURL="$ADM" postgres:16-alpine sh -c 'psql "$PGURL" -c "
EXPLAIN (ANALYZE, BUFFERS)
SELECT *, ts_rank_cd(to_tsvector('"'"'simple'"'"', COALESCE(value::text, '"'"''"'"')), plainto_tsquery('"'"'simple'"'"', '"'"'anticipatory bail'"'"')) AS _relevance
FROM nv_schema.memory_entries
WHERE user_id = (SELECT user_id FROM nv_schema.memory_entries GROUP BY user_id ORDER BY count(*) DESC LIMIT 1)
ORDER BY _relevance DESC LIMIT 20;"' 2>&1 | rg -i "Execution Time|ts_rank_cd|Seq Scan|Index Scan" | head -5

echo "=== applying $MIGFILE"
docker run --rm --network host -v "${REPO%/}/migrations":/mig -e PGURL="$ADM" postgres:16-alpine \
  sh -c "psql \"\$PGURL\" -v ON_ERROR_STOP=1 -f /mig/$MIGFILE" 2>&1 | tail -12

echo "=== verify: column + indexes exist ==="
docker run --rm --network host -e PGURL="$ADM" postgres:16-alpine sh -c 'psql "$PGURL" -At -F"|" -c "
SELECT '"'"'col'"'"', column_name, is_generated FROM information_schema.columns
 WHERE table_schema='"'"'nv_schema'"'"' AND table_name='"'"'memory_entries'"'"' AND column_name='"'"'value_tsv'"'"';
SELECT '"'"'idx'"'"', indexname FROM pg_indexes
 WHERE schemaname='"'"'nv_schema'"'"' AND tablename='"'"'memory_entries'"'"' AND indexname IN
 ('"'"'idx_memory_value_tsv'"'"','"'"'idx_memory_user_session'"'"','"'"'idx_memory_user_evict'"'"');"' 2>&1

echo "=== AFTER: new plan (expect the GIN/precomputed vector, no per-row to_tsvector) ==="
docker run --rm --network host -e PGURL="$ADM" postgres:16-alpine sh -c 'psql "$PGURL" -c "
EXPLAIN (ANALYZE, BUFFERS)
SELECT *, ts_rank_cd(value_tsv, plainto_tsquery('"'"'simple'"'"', '"'"'anticipatory bail'"'"')) AS _relevance
FROM nv_schema.memory_entries
WHERE user_id = (SELECT user_id FROM nv_schema.memory_entries GROUP BY user_id ORDER BY count(*) DESC LIMIT 1)
ORDER BY _relevance DESC LIMIT 20;"' 2>&1 | rg -i "Execution Time|ts_rank_cd|Seq Scan|Index Scan" | head -5

echo "=== SCALE TEST: does recall stay fast at 70k rows for ONE user? ==="
echo "    (this is the hypothesis under test — 1,430 rows proves nothing)"
docker run --rm --network host -e PGURL="$ADM" postgres:16-alpine sh -c 'psql "$PGURL" -v ON_ERROR_STOP=1 -c "
INSERT INTO nv_schema.memory_entries (user_id, memory_type, scope, key, value, importance)
SELECT '"'"'__scaletest_user__'"'"', '"'"'session'"'"', '"'"'user'"'"', '"'"'k'"'"' || g,
       jsonb_build_object('"'"'text'"'"', '"'"'anticipatory bail under BNSS 482 attachment PMLA row '"'"' || g),
       random()
  FROM generate_series(1, 70000) g;"' 2>&1 | tail -2
docker run --rm --network host -e PGURL="$ADM" postgres:16-alpine sh -c 'psql "$PGURL" -c "
EXPLAIN (ANALYZE, BUFFERS)
SELECT *, ts_rank_cd(value_tsv, plainto_tsquery('"'"'simple'"'"', '"'"'anticipatory bail'"'"')) AS _relevance
FROM nv_schema.memory_entries WHERE user_id = '"'"'__scaletest_user__'"'"'
ORDER BY _relevance DESC LIMIT 20;"' 2>&1 | rg -i "Execution Time|Index Scan|Seq Scan|Sort Method" | head -6
echo "    --- cleanup scale-test rows ---"
docker run --rm --network host -e PGURL="$ADM" postgres:16-alpine sh -c 'psql "$PGURL" -At -c "
DELETE FROM nv_schema.memory_entries WHERE user_id = '"'"'__scaletest_user__'"'"'; SELECT '"'"'remaining'"'"', count(*) FROM nv_schema.memory_entries WHERE user_id='"'"'__scaletest_user__'"'"';"' 2>&1

echo "=== APP role can still read (RLS / grants unbroken) ==="
APP="$(docker exec nyv-gateway printenv DATABASE_URL 2>/dev/null)"; APP="${APP%\"}"; APP="${APP#\"}"
APP="$(echo "$APP" | sed -E 's/sslmode=no-verify/sslmode=require/; s/sslmode=verify-full/sslmode=require/')"
docker run --rm --network host -e PGURL="$APP" postgres:16-alpine \
  sh -c 'psql "$PGURL" -At -F"|" -c "SELECT '"'"'app_read'"'"', count(*) FROM nv_schema.memory_entries;"' 2>&1
