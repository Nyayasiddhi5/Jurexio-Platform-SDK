#!/bin/sh
# Post-reset acceptance: prove the password change broke nothing and that both
# migrations are live and effective. Read-only apart from real AI traffic.
CANON=/opt/Nyayavigya/secrets/.env.production
K=`grep -E '^NYV_SDK_KEY_NSP=' "$CANON" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "\r\n"`
if [ `printf %s "$K" | wc -c` -lt 16 ]; then echo "PROBE BROKEN"; exit 3; fi
APP=`docker exec nyv-gateway printenv DATABASE_URL 2>/dev/null | sed -E 's/sslmode=no-verify/sslmode=require/'`
ADM=`grep -E '^DATABASE_URL_ADMIN=' "$CANON" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "\r\n" | sed -E 's/sslmode=no-verify/sslmode=require/'`

echo "=== 1. both roles authenticate (sentinel + rc, never username matching) ==="
for L in "app:$APP" "admin:$ADM"; do
  N=`printf %s "$L" | cut -d: -f1`; U=`printf %s "$L" | cut -d: -f2-`
  OUT=`docker run --rm --network host -e PGURL="$U" postgres:16-alpine sh -c 'psql "$PGURL" -At -c "SELECT 5150;"' 2>&1`; RC=$?
  if [ "$RC" = "0" ] && printf %s "$OUT" | grep -q '^5150$'; then echo "  $N: AUTH OK"; else echo "  $N: AUTH FAIL rc=$RC"; fi
done

echo ""
echo "=== 2. migrations are live ==="
docker run --rm --network host -e PGURL="$APP" postgres:16-alpine sh -c 'psql "$PGURL" -At -F"|" -c "
SELECT '\''value_tsv'\'', count(*)::text FROM information_schema.columns WHERE table_schema='\''nv_schema'\'' AND table_name='\''memory_entries'\'' AND column_name='\''value_tsv'\'';
SELECT '\''openbot_org_id_tables'\'', count(*)::text FROM information_schema.columns WHERE table_schema='\''nv_schema'\'' AND column_name='\''org_id'\'' AND table_name LIKE '\''nv_openbot%'\'';
SELECT '\''new_indexes'\'', count(*)::text FROM pg_indexes WHERE schemaname='\''nv_schema'\'' AND indexname IN ('\''idx_memory_value_tsv'\'','\''idx_memory_user_session'\'','\''idx_memory_user_evict'\'');"' 2>&1

echo ""
echo "=== 3. gateway state (no restart should have been needed) ==="
curl -sS -m 15 -o /dev/null -w "  local_health=%{http_code}\n" http://localhost:5000/health
curl -sS -m 20 -o /dev/null -w "  public_health=%{http_code}\n" https://api.nyayasiddhi.online/api/jrx/health
docker inspect nyv-gateway --format '  restarts={{.RestartCount}} oom={{.State.OOMKilled}} started={{.State.StartedAt}}'

echo ""
echo "=== 4. REAL AI traffic in NSP's shape (the actual acceptance test) ==="
curl -sS -m 120 -o /tmp/a1.json -w "  legal-chat-fast http=%{http_code} t=%{time_total}s\n" -X POST \
  -H "X-API-Key: $K" -H "X-NYV-Platform: nsp" -H "X-NYV-Consent: granted" \
  -H "X-Customer-User-Id: nsp:o:3:u:315" -H "X-Customer-Session-Id: nsp:o:3:u:315:t:91" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"In two lines: what is the limitation period for a cheque dishonour complaint under s.138 NI Act?","taskType":"legal-chat-fast","jurisdiction":"IN","enableMemory":true}' \
  https://api.nyayasiddhi.online/api/jrx/orchestrate
python3 -c "
import json;d=json.load(open('/tmp/a1.json')).get('data') or {}
print('  phase=%s session=%s chars=%d path=%s' % (d.get('requestPhase'), d.get('sessionId'), len(str(d.get('content') or '')), (d.get('routing') or {}).get('path')))
print('  memory contextUsed:', (d.get('memoryContext') or {}).get('contextUsed'))"

echo ""
echo "=== 5. memory write+read still works after the ALTER (generated col is maintained) ==="
docker run --rm --network host -e PGURL="$APP" postgres:16-alpine sh -c 'psql "$PGURL" -At -F"|" -c "
SELECT '\''rows'\'', count(*)::text FROM nv_schema.memory_entries;
SELECT '\''tsv_populated'\'', count(*)::text FROM nv_schema.memory_entries WHERE value_tsv IS NOT NULL;
SELECT '\''tsv_null'\'', count(*)::text FROM nv_schema.memory_entries WHERE value_tsv IS NULL;"' 2>&1

echo ""
echo "=== 6. errors since the reset ==="
LOG=`docker logs nyv-gateway --since 12m 2>&1`
for p in "password authentication failed" "org_id\" does not exist" "permission denied" "ECONNREFUSED" "value_tsv" "recall budget exhausted"; do
  printf '  %-34s %s\n' "$p" "`printf '%s' "$LOG" | grep -c "$p"`"
done
echo "  control: log_lines=`printf '%s' "$LOG" | wc -l`"
