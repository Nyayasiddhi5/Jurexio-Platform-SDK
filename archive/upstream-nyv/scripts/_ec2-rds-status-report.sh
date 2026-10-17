#!/bin/sh
# RDS + application connectivity status. READ ONLY — no credential is created,
# rotated, printed or modified anywhere in this script (NV-SECRETS-001,
# NV-NO-KEY-ROTATION-DEV-001).
#
# Question being answered: the APP role works (we have proved it repeatedly), the
# ADMIN role does not. So which roles exist, what can the app role actually do, and
# is anything in the platform degraded by the missing admin access?

CANON=/opt/Nyayavigya/secrets/.env.production
APP="$(docker exec nyv-gateway printenv DATABASE_URL 2>/dev/null | sed -E 's/sslmode=no-verify/sslmode=require/')"
if [ -z "$APP" ]; then echo "PROBE BROKEN: no DATABASE_URL"; exit 3; fi

q() { docker run --rm --network host -e PGURL="$APP" -e SQL="$1" postgres:16-alpine \
        sh -c 'psql "$PGURL" -At -F"|" -c "$SQL"' 2>&1; }

echo "=== 0. control: can the app role query at all? ==="
q "SELECT 'control_ok', current_user, version();" | head -2

echo ""
echo "=== 1. connection + pool health as the application sees it ==="
q "SELECT 'server_addr', inet_server_addr()::text, 'port', inet_server_port()::text;"
q "SELECT 'db', current_database(), 'schemas', string_agg(nspname, ',' ORDER BY nspname) FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema';"
q "SELECT 'active_connections', count(*)::text, 'max_conn', current_setting('max_connections') FROM pg_stat_activity WHERE datname = current_database();"
q "SELECT 'app_conns_by_state', state, count(*)::text FROM pg_stat_activity WHERE datname=current_database() GROUP BY state;"

echo ""
echo "=== 2. roles that exist, and what the app role is a member of ==="
q "SELECT 'role', rolname, 'super='||rolsuper::text, 'createdb='||rolcreatedb::text, 'login='||rolcanlogin::text FROM pg_roles WHERE rolname NOT LIKE 'pg_%' ORDER BY rolname;"
q "SELECT 'app_memberships', string_agg(r.rolname, ',') FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid JOIN pg_roles u ON u.oid=m.member WHERE u.rolname=current_user;"

echo ""
echo "=== 3. what the app role CAN and CANNOT do (this is the real blast radius) ==="
q "SELECT 'can_create_schema_nv', has_schema_privilege(current_user,'nv_schema','CREATE')::text,
          'can_usage_nv', has_schema_privilege(current_user,'nv_schema','USAGE')::text,
          'can_create_public', has_schema_privilege(current_user,'public','CREATE')::text;"
q "SELECT 'tables_in_nv_schema', count(*)::text FROM information_schema.tables WHERE table_schema='nv_schema';"
q "SELECT 'owned_by_app', count(*)::text FROM pg_tables WHERE schemaname='nv_schema' AND tableowner=current_user;"
q "SELECT 'owned_by_admin', count(*)::text FROM pg_tables WHERE schemaname='nv_schema' AND tableowner<>current_user;"
echo "  -> tables the app CAN alter = owned_by_app; the migration needs ALTER on memory_entries"
q "SELECT 'memory_entries_owner', tableowner FROM pg_tables WHERE schemaname='nv_schema' AND tablename='memory_entries';"

echo ""
echo "=== 4. is the app role's write path healthy (INSERT/UPDATE/DELETE grants)? ==="
q "SELECT 'privs_memory_entries', string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type)
     FROM information_schema.role_table_grants
    WHERE table_schema='nv_schema' AND table_name='memory_entries' AND grantee=current_user;"

echo ""
echo "=== 5. size + activity: is RDS actually serving the platform? ==="
q "SELECT 'db_size', pg_size_pretty(pg_database_size(current_database()));"
q "SELECT 'txn_commits', xact_commit::text, 'txn_rollbacks', xact_rollback::text, 'blks_hit', blks_hit::text, 'blks_read', blks_read::text FROM pg_stat_database WHERE datname=current_database();"
q "SELECT 'cache_hit_ratio_pct', round(100.0*blks_hit/GREATEST(blks_hit+blks_read,1),2)::text FROM pg_stat_database WHERE datname=current_database();"
q "SELECT 'top_tables_by_rows', relname, n_live_tup::text FROM pg_stat_user_tables ORDER BY n_live_tup DESC LIMIT 8;"

echo ""
echo "=== 6. recent write activity proves the app is USING it, not just connected ==="
q "SELECT 'recent_writes', relname, (n_tup_ins+n_tup_upd+n_tup_del)::text FROM pg_stat_user_tables WHERE (n_tup_ins+n_tup_upd+n_tup_del)>0 ORDER BY (n_tup_ins+n_tup_upd+n_tup_del) DESC LIMIT 8;"

echo ""
echo "=== 7. anything BLOCKED by the missing admin role? (schema-ensure at boot) ==="
LOG=`docker logs nyv-gateway --since 2h 2>&1`
echo -n "  admin-auth failures logged   : "; printf '%s' "$LOG" | grep -ci "password authentication failed" || true
echo -n "  ensure-schema errors         : "; printf '%s' "$LOG" | grep -ci "ensure.schema\|nv-ensure-schema" || true
echo -n "  permission denied errors     : "; printf '%s' "$LOG" | grep -ci "permission denied" || true
echo -n "  relation does not exist      : "; printf '%s' "$LOG" | grep -ci "does not exist" || true
echo -n "  DB connection errors         : "; printf '%s' "$LOG" | grep -ci "ECONNREFUSED\|connection terminated\|too many clients" || true
echo "  control: log_lines=`printf '%s' "$LOG" | wc -l`"

echo ""
echo "=== 8. which code paths WANT the admin URL (i.e. what is degraded) ==="
docker exec nyv-gateway sh -c 'grep -rln "DATABASE_URL_ADMIN" /app/src 2>/dev/null'
