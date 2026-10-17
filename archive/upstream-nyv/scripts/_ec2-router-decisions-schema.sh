#!/bin/sh
# Which nv_router_decisions column is varchar(64), and which value overflows it.
# Positive control: column count must be >0 or we are querying the wrong DB/schema.
set -e
CANON=/opt/Nyayavigya/secrets/.env.production
DBURL=`grep -E '^DATABASE_URL=' "$CANON" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "\r\n"`
if [ -z "$DBURL" ]; then echo "PROBE BROKEN: no DATABASE_URL"; exit 3; fi
# NV-VALIDATE-THE-PROBE-001: node/pg accepts sslmode=no-verify, psql does not.
# Rewrite it for psql rather than reading the failure as a platform defect.
DBURL=`printf %s "$DBURL" | sed -e 's/sslmode=no-verify/sslmode=require/'`

echo "=== control + column widths for nv_router_decisions ==="
docker exec -i nyv-postgres psql "$DBURL" -v ON_ERROR_STOP=1 <<'SQL'
SELECT count(*) AS control_column_count
  FROM information_schema.columns
 WHERE table_name = 'nv_router_decisions';

SELECT table_schema, column_name, data_type, character_maximum_length AS maxlen
  FROM information_schema.columns
 WHERE table_name = 'nv_router_decisions'
   AND character_maximum_length IS NOT NULL
 ORDER BY character_maximum_length, column_name;

SELECT count(*) AS rows_persisted, max(ts) AS newest
  FROM nv_router_decisions;
SQL

echo "=== how long are the values we actually send? (model ids / providers) ==="
LOG=`docker logs nyv-gateway --since 3h 2>&1`
printf '%s' "$LOG" | grep -oE '"llm\.model":"[^"]+"' | sort -u | awk -F'"' '{print length($4), $4}' | sort -rn | head -10
echo "control: distinct_models=`printf '%s' "$LOG" | grep -coE '\"llm\.model\":\"[^\"]+\"'`"

echo "=== agentKey / taskKind lengths seen in logs ==="
printf '%s' "$LOG" | grep -oE '"agentKey":"[^"]+"' | sort -u | awk -F'"' '{print length($4), $4}' | sort -rn | head -5
