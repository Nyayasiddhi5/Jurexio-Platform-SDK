#!/bin/sh
# RDS schema optimisation audit. Now runnable because the master credential works.
# Read-only: no DDL, no writes. Finds the concrete optimisation gaps.
CANON=/opt/Nyayavigya/secrets/.env.production
ADM=`grep -E '^DATABASE_URL_ADMIN=' "$CANON" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "\r\n" | sed -E 's/sslmode=no-verify/sslmode=require/'`
q() { docker run --rm --network host -e PGURL="$ADM" -e SQL="$1" postgres:16-alpine sh -c 'psql "$PGURL" -c "$SQL"' 2>&1; }

echo "=== control: connected as admin ==="
q "SELECT current_user, pg_size_pretty(pg_database_size(current_database())) AS db_size;" | head -4

echo ""
echo "=== 1. instance-level settings that matter for our workload ==="
q "SELECT name, setting, unit FROM pg_settings WHERE name IN ('max_connections','shared_buffers','effective_cache_size','work_mem','maintenance_work_mem','random_page_cost','max_parallel_workers_per_gather','default_statistics_target','autovacuum','track_io_timing','shared_preload_libraries') ORDER BY name;"

echo ""
echo "=== 2. biggest tables + index-to-table ratio ==="
q "SELECT relname AS table, pg_size_pretty(pg_total_relation_size(c.oid)) AS total, pg_size_pretty(pg_relation_size(c.oid)) AS heap, pg_size_pretty(pg_indexes_size(c.oid)) AS idx, n_live_tup AS rows FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_stat_user_tables s ON s.relid=c.oid WHERE n.nspname='nv_schema' AND c.relkind='r' ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 12;"

echo ""
echo "=== 3. SEQ SCAN offenders: hot tables with no index usage (the real optimisation list) ==="
q "SELECT relname, seq_scan, idx_scan, n_live_tup, CASE WHEN seq_scan+COALESCE(idx_scan,0)=0 THEN 0 ELSE round(100.0*seq_scan/(seq_scan+COALESCE(idx_scan,0)),1) END AS pct_seq FROM pg_stat_user_tables WHERE schemaname='nv_schema' AND seq_scan > 100 AND n_live_tup > 500 ORDER BY seq_scan DESC LIMIT 12;"

echo ""
echo "=== 4. UNUSED indexes (write cost, no read benefit) ==="
q "SELECT relname AS table, indexrelname AS idx, pg_size_pretty(pg_relation_size(i.indexrelid)) AS size, idx_scan FROM pg_stat_user_indexes i JOIN pg_index x ON x.indexrelid=i.indexrelid WHERE schemaname='nv_schema' AND idx_scan=0 AND NOT x.indisprimary AND NOT x.indisunique AND pg_relation_size(i.indexrelid) > 16384 ORDER BY pg_relation_size(i.indexrelid) DESC LIMIT 12;"

echo ""
echo "=== 5. bloat / vacuum health on the busiest tables ==="
q "SELECT relname, n_live_tup, n_dead_tup, CASE WHEN n_live_tup=0 THEN 0 ELSE round(100.0*n_dead_tup/n_live_tup,1) END AS dead_pct, last_autovacuum, last_autoanalyze FROM pg_stat_user_tables WHERE schemaname='nv_schema' AND n_dead_tup > 100 ORDER BY n_dead_tup DESC LIMIT 10;"

echo ""
echo "=== 6. pgvector: is it installed and are embedding columns indexed? ==="
q "SELECT extname, extversion FROM pg_extension ORDER BY extname;"
q "SELECT c.relname AS table, a.attname AS col, format_type(a.atttypid,a.atttypmod) AS type FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='nv_schema' AND format_type(a.atttypid,a.atttypmod) LIKE 'vector%' AND a.attnum>0;"
q "SELECT indexrelname, indexdef FROM pg_stat_user_indexes i JOIN pg_indexes d ON d.indexname=i.indexrelname WHERE i.schemaname='nv_schema' AND (indexdef ILIKE '%hnsw%' OR indexdef ILIKE '%ivfflat%');"

echo ""
echo "=== 7. missing FK indexes (FK column with no leading index = slow joins/cascades) ==="
q "SELECT c.conrelid::regclass AS child, a.attname AS fk_col FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1] JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.contype='f' AND n.nspname='nv_schema' AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid=c.conrelid AND i.indkey[0]=c.conkey[1]) LIMIT 12;"

echo ""
echo "=== 8. RLS posture (multi-tenant safety) ==="
q "SELECT count(*) FILTER (WHERE rowsecurity) AS rls_enabled, count(*) FILTER (WHERE NOT rowsecurity) AS rls_disabled FROM pg_tables WHERE schemaname='nv_schema';"
q "SELECT tablename FROM pg_tables WHERE schemaname='nv_schema' AND rowsecurity ORDER BY tablename LIMIT 10;"

echo ""
echo "=== 9. connection headroom vs app pool ==="
q "SELECT current_setting('max_connections') AS max_conn, count(*) AS in_use, count(*) FILTER (WHERE state='idle') AS idle, count(*) FILTER (WHERE state='active') AS active FROM pg_stat_activity;"
echo -n "  app pool env: "; docker exec nyv-gateway sh -c 'printenv | grep -E "^(DB_POOL_MAX|DB_POOL_SIZE|NYV_DB_POOL_MAX)=" | tr "\n" " "'
