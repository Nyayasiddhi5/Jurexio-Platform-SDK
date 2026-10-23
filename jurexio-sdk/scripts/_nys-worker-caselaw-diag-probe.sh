#!/usr/bin/env bash
# NYS caselaw-worker diag — health, embed, RDS, local search.
set -uo pipefail

echo "=== HOST ==="
echo "uptime: $(uptime | awk -F'load average:' '{print $2}')"
echo "date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo "=== API SERVICE ==="
systemctl is-active jrx-api 2>/dev/null || echo "jrx-api systemctl N/A"
docker ps --format '{{.Names}} {{.Status}}' 2>/dev/null | grep -iE 'nys|nyv|api' || true
pm2 list 2>/dev/null | head -8 || true

echo "=== EMBED UNITS ==="
for u in jrx-caselaw-embed-loop@{0,1,2} jrx-caselaw-embed-dc jrx-embed-statutes-loop; do
  st=$(systemctl is-active "$u" 2>/dev/null || echo inactive)
  echo "embed $u: $st"
done

echo "=== ENV (key presence) ==="
ENV_FILE="/opt/nyv/api/.env"
if [ -f "$ENV_FILE" ]; then
  for k in DATABASE_URL JRX_ECOSYSTEM_KNOWLEDGE_API_KEY JRX_ECOSYSTEM_SDK_API_KEYS; do
    if grep -qE "^${k}=" "$ENV_FILE" 2>/dev/null; then
      len=$(grep -E "^${k}=" "$ENV_FILE" | head -1 | cut -d= -f2- | wc -c)
      echo "$k=set len=$len"
    else
      echo "$k=UNSET"
    fi
  done
else
  echo "env_file_missing: $ENV_FILE"
fi

echo "=== LOCAL HEALTH ==="
curl -sS -m 5 http://127.0.0.1:8080/health 2>/dev/null | head -c 300 || echo health_fail
echo

echo "=== LOCAL CASELAW SEARCH ==="
set -a
# shellcheck disable=SC1091
source /opt/nyv/api/.env 2>/dev/null || true
set +a
KEY="${JRX_ECOSYSTEM_KNOWLEDGE_API_KEY:-${JRX_ECOSYSTEM_SDK_API_KEYS:-}}"; KEY="${KEY%%,*}"
for mode in fts hybrid default; do
  tmp=$(mktemp)
  code=$(curl -sS -m 45 -o "$tmp" -w '%{http_code}' -H "x-api-key: $KEY" \
    "http://127.0.0.1:8080/api/caselaw/search?q=Section+420+IPC&limit=5&mode=$mode" 2>/dev/null || echo ERR)
  python3 - "$mode" "$code" "$tmp" <<'PY'
import json, sys
mode, code, path = sys.argv[1:4]
try:
    d = json.load(open(path))
    total = d.get("total", "?")
    method = d.get("method", d.get("searchMode", "-"))
    err = d.get("error", "-")
    print(f"LOCAL mode={mode} http={code} total={total} method={method} err={str(err)[:60]}")
except Exception as e:
    print(f"LOCAL mode={mode} http={code} parse_err={e} raw={open(path).read()[:120]}")
PY
  rm -f "$tmp"
done

echo "=== RDS CONNECTION TEST ==="
python3 <<'PY' 2>/dev/null || echo rds_test_skip
import os, subprocess
db = os.environ.get("DATABASE_URL", "")
if not db:
    print("RDS skip: no DATABASE_URL")
else:
    # psql count only — no credentials echoed
    r = subprocess.run(
        ["psql", db, "-tAc", "SELECT COUNT(*) FROM judgments LIMIT 1;"],
        capture_output=True, text=True, timeout=15
    )
    print(f"RDS judgments_count rc={r.returncode} count={r.stdout.strip()[:20]} err={r.stderr[:80] if r.returncode else ''}")
PY

echo "=== API LOG TAIL (errors) ==="
tail -30 /opt/nyv/logs/api.log 2>/dev/null | grep -iE 'error|503|timeout|57014|caselaw|search' || \
  journalctl -u jrx-api -n 20 --no-pager 2>/dev/null | grep -iE 'error|503|timeout|caselaw' || \
  echo no_error_log

echo "=== PROBE COMPLETE ==="
