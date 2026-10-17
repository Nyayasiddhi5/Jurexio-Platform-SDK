#!/usr/bin/env bash
# Post-embed-pause caselaw + CNR verification on NYS worker and via gateway.
set -uo pipefail
set -a
source /opt/nyv/api/.env 2>/dev/null || true
set +a
KEY="${JRX_ECOSYSTEM_KNOWLEDGE_API_KEY:-${JRX_ECOSYSTEM_SDK_API_KEYS:-}}"; KEY="${KEY%%,*}"

echo "=== EMBED STATUS ==="
for u in jrx-caselaw-embed-loop@{0,1,2} jrx-caselaw-embed-dc jrx-embed-statutes-loop; do
  echo "$u: $(systemctl is-active $u 2>/dev/null || echo inactive)"
done

echo "=== LOCAL NYS (jurisdiction=IN) ==="
for mode in fts hybrid; do
  tmp=$(mktemp)
  code=$(curl -sS -m 30 -o "$tmp" -w '%{http_code}' -H "x-api-key: $KEY" \
    "http://127.0.0.1:8080/api/caselaw/search?q=Section+420+IPC&limit=5&jurisdiction=IN&mode=$mode" 2>/dev/null || echo ERR)
  python3 - "$mode" "$code" "$tmp" <<'PY'
import json, sys
mode, code, path = sys.argv[1:4]
try:
    d = json.load(open(path))
    print(f"LOCAL mode={mode} http={code} total={d.get('total','?')} method={d.get('method','-')}")
except Exception as e:
    print(f"LOCAL mode={mode} http={code} err={e}")
PY
  rm -f "$tmp"
done

echo "=== RDS idle tx check ==="
python3 <<'PY' 2>/dev/null || echo rds_skip
import os, subprocess
db = os.environ.get("DATABASE_URL", "")
if db:
    q = "SELECT count(*) FROM pg_stat_activity WHERE state = 'idle in transaction' AND query NOT LIKE '%pg_stat%';"
    r = subprocess.run(["psql", db, "-tAc", q], capture_output=True, text=True, timeout=10)
    print(f"idle_in_tx={r.stdout.strip()} rc={r.returncode}")
PY

echo "=== DONE ==="
