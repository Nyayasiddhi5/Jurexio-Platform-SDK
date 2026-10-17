#!/bin/sh
# Why did DATABASE_URL_ADMIN fail, and can the migration proceed without it?
# NV-SECRETS-001: print NAMES, lengths and roles only — never a secret value.
# NV-NO-KEY-ROTATION-DEV-001: do NOT rotate anything; this is diagnosis only.

echo "=== which DB env vars exist in the container (names only) ==="
docker exec nyv-gateway sh -c 'printenv | grep -oE "^[A-Z_]*(DATABASE|PG|DB)[A-Z_]*" | sort -u'

echo ""
echo "=== admin vs app credential shape (lengths + user only, no values) ==="
for V in DATABASE_URL DATABASE_URL_ADMIN; do
  RAW="$(docker exec nyv-gateway printenv $V 2>/dev/null)"
  if [ -z "$RAW" ]; then echo "  $V = <unset>"; continue; fi
  USER=$(printf %s "$RAW" | sed -E 's#^[a-z]+://([^:]+):.*#\1#')
  HOST=$(printf %s "$RAW" | sed -E 's#.*@([^:/]+).*#\1#')
  DBN=$(printf %s "$RAW" | sed -E 's#.*/([^?]+).*#\1#')
  PWLEN=$(printf %s "$RAW" | sed -E 's#^[a-z]+://[^:]+:([^@]*)@.*#\1#' | wc -c)
  echo "  $V user=$USER host=$HOST db=$DBN pw_len=$(($PWLEN-1))"
done

echo ""
echo "=== does the APP role own nv_schema.memory_entries (can it ALTER)? ==="
APP="$(docker exec nyv-gateway printenv DATABASE_URL 2>/dev/null)"; APP="${APP%\"}"; APP="${APP#\"}"
APP="$(echo "$APP" | sed -E 's/sslmode=no-verify/sslmode=require/; s/sslmode=verify-full/sslmode=require/')"
docker run --rm --network host -e PGURL="$APP" postgres:16-alpine sh -c 'psql "$PGURL" -At -F"|" -c "
SELECT current_user AS whoami, session_user;
SELECT '"'"'owner'"'"', tableowner FROM pg_tables WHERE schemaname='"'"'nv_schema'"'"' AND tablename='"'"'memory_entries'"'"';
SELECT '"'"'is_member_of_owner'"'"', pg_has_role(current_user, (SELECT tableowner FROM pg_tables WHERE schemaname='"'"'nv_schema'"'"' AND tablename='"'"'memory_entries'"'"'), '"'"'USAGE'"'"');
SELECT '"'"'can_create_in_schema'"'"', has_schema_privilege(current_user, '"'"'nv_schema'"'"', '"'"'CREATE'"'"');"' 2>&1

echo ""
echo "=== is the fallback path live? (code must degrade, not throw) ==="
docker exec nyv-gateway sh -c 'grep -c "hasTsvColumn" /app/src/services/jrx-orchestration-services.ts'
docker exec nyv-gateway sh -c 'grep -c "value_tsv" /app/src/services/jrx-orchestration-services.ts'

echo ""
echo "=== recall still healthy on the OLD expression? ==="
LOG=`docker logs nyv-gateway --since 15m 2>&1`
echo -n "  memory store/recall failures: "; printf '%s' "$LOG" | grep -c "memory store failed\|recall failed" || true
echo -n "  column does not exist errors: "; printf '%s' "$LOG" | grep -c "value_tsv" || true
echo "  control: log_lines=`printf '%s' "$LOG" | wc -l`"
