#!/usr/bin/env bash
# RDS recovery probe after embed pause — bail + 420 IPC, pg cleanup, optional api restart.
set -uo pipefail
set -a
source /opt/nyv/api/.env 2>/dev/null || true
set +a
KEY="${JRX_ECOSYSTEM_KNOWLEDGE_API_KEY:-${JRX_ECOSYSTEM_SDK_API_KEYS:-}}"; KEY="${KEY%%,*}"

echo "=== PG CLEANUP (aborted idle tx) ==="
node /opt/nyv/scripts/_nys-cnr-pg-cleanup.mjs 2>/dev/null || \
  bash /opt/nyv/scripts/_nys-cnr-pg-cleanup.sh 2>/dev/null || \
  echo "cleanup_script_not_found_trying_inline"
if [ -f /opt/nyv/scripts/_nys-cnr-pg-cleanup.sh ]; then
  bash /opt/nyv/scripts/_nys-cnr-pg-cleanup.sh
fi

echo "=== JUDGMENTS COUNT ==="
psql "$DATABASE_URL" -tAc "SELECT COUNT(*) FROM judgments;" 2>/dev/null | head -1 || echo count_fail

echo "=== SEARCH PROBES (jurisdiction=IN) ==="
for q in "bail" "Section+420+IPC" "anticipatory+bail"; do
  for mode in fts hybrid; do
    tmp=$(mktemp)
    code=$(curl -sS -m 45 -o "$tmp" -w '%{http_code}' -H "x-api-key: $KEY" \
      "http://127.0.0.1:8080/api/caselaw/search?q=${q}&limit=5&jurisdiction=IN&courtType=sc&mode=$mode" 2>/dev/null || echo ERR)
    python3 - "$q" "$mode" "$code" "$tmp" <<'PY'
import json, sys
q, mode, code, path = sys.argv[1:5]
try:
    d = json.load(open(path))
    print(f"q={q} mode={mode} http={code} total={d.get('total','?')} method={d.get('method','-')} degraded={d.get('degraded','-')}")
except Exception as e:
    raw = open(path).read()[:100] if path else ''
    print(f"q={q} mode={mode} http={code} err={e} raw={raw}")
PY
    rm -f "$tmp"
  done
done

echo "=== PG ACTIVITY ==="
psql "$DATABASE_URL" -tAc "SELECT state, count(*) FROM pg_stat_activity WHERE datname=current_database() GROUP BY state;" 2>/dev/null || echo pg_activity_fail

echo "=== API RESTART ==="
systemctl restart jrx-api 2>/dev/null && echo "jrx-api restarted" || echo "restart_skip"
sleep 3
curl -sS -m 5 http://127.0.0.1:8080/health 2>/dev/null | head -c 80 || echo health_fail
echo

echo "=== POST-RESTART bail fts ==="
tmp=$(mktemp)
code=$(curl -sS -m 30 -o "$tmp" -w '%{http_code}' -H "x-api-key: $KEY" \
  "http://127.0.0.1:8080/api/caselaw/search?q=bail&limit=5&jurisdiction=IN&courtType=sc&mode=fts" 2>/dev/null || echo ERR)
python3 - "$code" "$tmp" <<'PY'
import json, sys
code, path = sys.argv[1:3]
try:
    d = json.load(open(path))
    print(f"post_restart bail fts http={code} total={d.get('total','?')} method={d.get('method')}")
except Exception as e:
    print(f"post_restart err={e}")
PY
rm -f "$tmp"
echo "=== DONE ==="
